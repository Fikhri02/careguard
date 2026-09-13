import type { ChatCompletionMessage, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assistantText, assistantToolCall, FakeLlm, fakeSearch, silentLogger, type LlmResponder } from "../test/fakes.js";
import { createTestServices } from "../test/harness.js";
import { buildTools } from "./registry.js";
import { runTurn, STEP_LIMIT_REPLY, type RunTurnInput } from "./runner.js";
import { defineTool, type ToolSet } from "./tool.js";

const user = (text: string): ChatCompletionUserMessageParam => ({ role: "user", content: [{ type: "text", text }] });
const SCAM = "Akaun Maybank anda telah disekat. Sila sahkan segera di maybank-verify.xyz";

function setup(llm: FakeLlm, searchDelayMs = 0) {
  const t = createTestServices({ search: fakeSearch([], searchDelayMs) });
  const tools = buildTools({ ...t.services, search: t.search });
  const mak = t.services.elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  const tok = t.services.elders.findOrCreateByPhone("whatsapp:+60199999999", "Tok");
  const turn = (overrides: Partial<RunTurnInput> = {}) =>
    runTurn({
      elder: mak,
      system: "test system",
      history: [user("Hai")],
      tools,
      llm,
      messenger: t.messenger,
      clock: t.clock,
      log: silentLogger,
      ...overrides,
    });
  return { ...t, mak, tok, turn };
}

describe("runTurn", () => {
  it("returns a plain text reply", async () => {
    const llm = FakeLlm.scripted([assistantText("Hai Mak!")]);
    const { turn } = setup(llm);

    await expect(turn()).resolves.toEqual({ reply: "Hai Mak!", newMessages: [{ role: "assistant", content: "Hai Mak!" }] });
    expect(llm.requests[0]!.system).toBe("test system");
    expect(llm.requests[0]!.messages).toEqual([user("Hai")]);
    expect(llm.requests[0]!.tools.map((tool) => tool.function.name)).toContain("investigate_message");
  });

  it("runs tool calls for the current elder and feeds results back", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("log_document", { kind: "bill", summary: "TNB bill RM143" }, "call_1"),
      assistantText("Ini bil TNB."),
    ]);
    const { turn, services, mak } = setup(llm);
    const called: string[] = [];

    const result = await turn({ onToolCall: (name) => called.push(name) });

    expect(result.reply).toBe("Ini bil TNB.");
    expect(result.newMessages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(result.newMessages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Logged for the family timeline." });
    expect(llm.requests[1]!.messages.at(-1)).toEqual(result.newMessages[1]);
    expect(called).toEqual(["log_document"]);
    expect(services.events.list({ elderId: mak.id })).toHaveLength(1);
  });

  it("reports unknown tools and unparseable arguments back to the model", async () => {
    const badJson: ChatCompletionMessage = {
      role: "assistant",
      content: null,
      refusal: null,
      tool_calls: [{ id: "call_2", type: "function", function: { name: "log_document", arguments: "{not json" } }],
    };
    const llm = FakeLlm.scripted([assistantToolCall("launch_rocket", {}, "call_1"), badJson, assistantText("Maaf.")]);
    const { turn } = setup(llm);

    const { newMessages } = await turn();

    expect(newMessages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Unknown tool: launch_rocket" });
    expect((newMessages[3] as { content: string }).content).toMatch(/^Invalid arguments for log_document/);
  });

  it("turns a tool exception into text", async () => {
    const boom: ToolSet = {
      boom: defineTool({
        name: "boom",
        description: "Always fails.",
        input: z.object({}),
        run: async () => {
          throw new Error("kaput");
        },
      }),
    };
    const llm = FakeLlm.scripted([assistantToolCall("boom", {}, "call_1"), assistantText("ok")]);
    const { turn } = setup(llm);

    const { newMessages } = await turn({ tools: boom });

    expect(newMessages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: 'Tool "boom" failed: kaput' });
  });

  it("stops at the step limit with a fallback reply", async () => {
    const llm = new FakeLlm(() => assistantToolCall("log_document", { kind: "other", summary: "loop" }));
    const { turn } = setup(llm);

    const result = await turn({ maxSteps: 2 });

    expect(result.reply).toBe(STEP_LIMIT_REPLY);
    expect(llm.requests).toHaveLength(2);
  });

  it("P2 regression: concurrent turns record events against their own elder", async () => {
    const respond: LlmResponder = (request) => {
      const last = request.messages.at(-1)!;
      if (last.role === "tool") return assistantText("Hati-hati, itu scam.");
      return JSON.stringify(last.content).includes("disekat")
        ? assistantToolCall("investigate_message", { text: SCAM, urls: ["maybank-verify.xyz"] })
        : assistantText("Hai!");
    };
    // The 20 ms search stalls Mak's tool call while Tok's whole turn completes.
    const { turn, services, mak, tok } = setup(new FakeLlm(respond), 20);

    await Promise.all([turn({ elder: mak, history: [user(SCAM)] }), turn({ elder: tok, history: [user("Hai CareGuard")] })]);

    expect(services.events.list({ elderId: mak.id }).map((e) => e.type)).toEqual(["scam_detected"]);
    expect(services.events.list({ elderId: tok.id })).toEqual([]);
  });
});

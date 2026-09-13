import type { ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import { assistantText, assistantToolCall, FakeLlm, fakeSearch, silentLogger, type LlmResponder } from "../test/fakes.js";
import { createTestServices } from "../test/harness.js";
import { createInboundPipeline, FALLBACK_REPLY } from "./pipeline.js";
import { buildTools } from "./registry.js";
import { createTurnQueue } from "./turn-queue.js";

const MAK = "whatsapp:+60123456789";
const TOK = "whatsapp:+60199999999";
const SCAM = "Akaun Maybank anda telah disekat. Sila sahkan segera di maybank-verify.xyz";
const text = (t: string): ChatCompletionUserMessageParam => ({ role: "user", content: [{ type: "text", text: t }] });

function setup(llm: FakeLlm, searchDelayMs = 0) {
  const t = createTestServices({ search: fakeSearch([], searchDelayMs) });
  const tools = buildTools({ ...t.services, search: t.search });
  const pipeline = createInboundPipeline({ services: t.services, tools, llm, queue: createTurnQueue(), clock: t.clock, log: silentLogger });
  return { ...t, pipeline };
}

describe("InboundPipeline", () => {
  it("creates the elder, replies through the turn's messenger, and persists the exchange", async () => {
    const llm = FakeLlm.scripted([assistantText("Hai Mak!")]);
    const { pipeline, messenger, services } = setup(llm);

    const result = await pipeline.handle({ phone: MAK, message: text("Hai"), externalId: "SM1", messenger });

    expect(result).toEqual({ status: "replied", reply: "Hai Mak!", events: [] });
    expect(messenger.sent).toEqual([{ to: MAK, body: "Hai Mak!" }]);
    const [elder] = services.elders.list();
    expect(elder!.phone).toBe(MAK);
    expect(services.conversation.window(elder!.id).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(llm.requests[0]!.system).toContain('You are "CareGuard"');
  });

  it("ignores a duplicate Twilio message", async () => {
    const llm = FakeLlm.scripted([assistantText("Hai Mak!")]);
    const { pipeline, messenger } = setup(llm);

    await pipeline.handle({ phone: MAK, message: text("Hai"), externalId: "SM1", messenger });
    const again = await pipeline.handle({ phone: MAK, message: text("Hai"), externalId: "SM1", messenger });

    expect(again).toEqual({ status: "duplicate", reply: null, events: [] });
    expect(llm.requests).toHaveLength(1);
    expect(messenger.sent).toHaveLength(1);
  });

  it("sends the fallback reply when the model fails, keeping the elder's message", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("OPENAI_API_KEY is not set");
    });
    const { pipeline, messenger, services } = setup(llm);

    const result = await pipeline.handle({ phone: MAK, message: text("Hai"), messenger });

    expect(result).toEqual({ status: "failed", reply: FALLBACK_REPLY, events: [] });
    expect(messenger.sent).toEqual([{ to: MAK, body: FALLBACK_REPLY }]);
    expect(services.conversation.window(services.elders.list()[0]!.id)).toHaveLength(1);
  });

  it("falls back when the model returns an empty reply", async () => {
    const { pipeline, messenger } = setup(FakeLlm.scripted([assistantText("  ")]));
    await expect(pipeline.handle({ phone: MAK, message: text("Hai"), messenger })).resolves.toMatchObject({
      status: "replied",
      reply: FALLBACK_REPLY,
    });
  });

  it("shows the photo to the model but stores [photo]", async () => {
    const llm = FakeLlm.scripted([assistantText("Ini bil TNB.")]);
    const { pipeline, messenger, services } = setup(llm);
    const photo: ChatCompletionUserMessageParam = {
      role: "user",
      content: [
        { type: "text", text: "Bil apa ni?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    };

    await pipeline.handle({ phone: MAK, message: photo, messenger });

    expect(llm.requests[0]!.messages.at(-1)).toEqual(photo);
    expect(services.conversation.window(services.elders.list()[0]!.id)[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Bil apa ni?" }, { type: "text", text: "[photo]" }],
    });
  });

  it("reports events recorded during the turn", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("log_document", { kind: "bill", summary: "TNB bill RM143" }),
      assistantText("Ini bil TNB."),
    ]);
    const { pipeline, messenger } = setup(llm);
    const result = await pipeline.handle({ phone: MAK, message: text("[photo of bill]"), messenger });
    expect(result.events.map((e) => e.type)).toEqual(["bill_explained"]);
  });

  it("sends family alerts through the turn's messenger, not the process messenger", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("register_family", { phone: "0123456789", name: "Aisyah" }, "c1"),
      assistantToolCall("notify_family", { summary: "fake Maybank SMS" }, "c2"),
      assistantText("Dah beritahu Aisyah."),
    ]);
    const { pipeline, messenger: processMessenger } = setup(llm);
    const turnMessenger = new CapturingMessenger();

    await pipeline.handle({ phone: TOK, message: text("Tolong beritahu anak saya"), messenger: turnMessenger });

    expect(turnMessenger.sent.map((m) => m.to)).toEqual(["+60123456789", TOK]);
    expect(processMessenger.sent).toEqual([]);
  });

  it("P2 regression: concurrent elders keep their own events and replies", async () => {
    const respond: LlmResponder = (request) => {
      const last = request.messages.at(-1)!;
      if (last.role === "tool") return assistantText("Hati-hati, itu scam.");
      return JSON.stringify(last.content).includes("disekat")
        ? assistantToolCall("investigate_message", { text: SCAM, urls: ["maybank-verify.xyz"] })
        : assistantText("Hai!");
    };
    const { pipeline, messenger, services } = setup(new FakeLlm(respond), 20);

    await Promise.all([
      pipeline.handle({ phone: MAK, message: text(SCAM), messenger }),
      pipeline.handle({ phone: TOK, message: text("Hai CareGuard"), messenger }),
    ]);

    const mak = services.elders.list().find((e) => e.phone === MAK)!;
    const tok = services.elders.list().find((e) => e.phone === TOK)!;
    expect(services.events.list({ elderId: mak.id }).map((e) => e.type)).toEqual(["scam_detected"]);
    expect(services.events.list({ elderId: tok.id })).toEqual([]);
    expect(messenger.sent).toEqual(
      expect.arrayContaining([
        { to: MAK, body: "Hati-hati, itu scam." },
        { to: TOK, body: "Hai!" },
      ]),
    );
  });

  it("processes one elder's messages in order, each seeing the previous reply", async () => {
    const llm = new FakeLlm((_request, index) => assistantText(`reply ${index}`));
    const { pipeline, messenger } = setup(llm);

    await Promise.all([
      pipeline.handle({ phone: MAK, message: text("first"), messenger }),
      pipeline.handle({ phone: MAK, message: text("second"), messenger }),
    ]);

    expect(llm.requests[1]!.messages).toEqual([text("first"), { role: "assistant", content: "reply 0" }, text("second")]);
  });
});

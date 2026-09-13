import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { localizeWarningHeader, replyLanguageHint, toolsForTurn } from "./reply-format.js";
import type { Tool, ToolSet } from "./tool.js";

const user = (text: string): ChatCompletionMessageParam => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string): ChatCompletionMessageParam => ({ role: "assistant", content: text });
const stub = {} as Tool;
const tools: ToolSet = { log_document: stub, create_reminder: stub, investigate_message: stub };

describe("localizeWarningHeader", () => {
  it("switches a Malay warning line to English when the reply is in English", () => {
    expect(localizeWarningHeader("🚨 Hati-hati!\nThis message is likely a scam. Do not click the link.")).toBe(
      "🚨 Be careful\nThis message is likely a scam. Do not click the link.",
    );
  });

  it("keeps the Malay warning line on a Malay reply", () => {
    const reply = "🚨 Hati-hati\nIni scam. Jangan tekan link tu.";
    expect(localizeWarningHeader(reply)).toBe(reply);
  });

  it("leaves replies alone when the warning shares a line with other text, or there is no warning", () => {
    expect(localizeWarningHeader("🚨 Hati-hati! This is a scam.\nDon't click it.")).toBe("🚨 Hati-hati! This is a scam.\nDon't click it.");
    expect(localizeWarningHeader("This looks fine.\nNo action needed.")).toBe("This looks fine.\nNo action needed.");
  });
});

describe("replyLanguageHint", () => {
  it("pins English for an English speaker", () => {
    const history = [user("URGENT: Your PosLaju parcel is held at customs. Pay RM2.50 now at http://bit.ly/x or it will be returned.")];
    expect(replyLanguageHint(history)).toContain("English");
  });

  it("keeps Malay for a Malay speaker who forwards an English scam SMS", () => {
    const history = [
      user("Assalamualaikum, saya nak tanya boleh tak awak tolong saya?"),
      assistant("Waalaikumsalam, boleh. Apa yang saya boleh bantu?"),
      user("Ada mesej ni masuk tadi, betul ke tak?"),
      user("URGENT: Your parcel is held. Pay now at http://bit.ly/x"),
    ];
    expect(replyLanguageHint(history)).toContain("Bahasa Melayu");
  });

  it("gives no hint when it's too close to call", () => {
    expect(replyLanguageHint([user("ok")])).toBeNull();
  });
});

describe("toolsForTurn", () => {
  it("hides create_reminder when no reminder was offered or asked for", () => {
    const history = [user("Bil TNB saya bulan ni RM143.20, tarikh akhir 25 September. Apa maksud ni?")];
    expect(Object.keys(toolsForTurn(tools, history)).sort()).toEqual(["investigate_message", "log_document"]);
  });

  it("allows create_reminder after CareGuard offered one", () => {
    const history = [user("Bil TNB apa ni?"), assistant("Ini bil TNB, RM143.20. Nak saya ingatkan awak nanti?"), user("Ya")];
    expect(toolsForTurn(tools, history)).toHaveProperty("create_reminder");
  });

  it("allows create_reminder when the elder asks for a reminder directly", () => {
    expect(toolsForTurn(tools, [user("Tolong ingatkan saya bayar bil esok pagi")])).toHaveProperty("create_reminder");
  });

  it("looks past tool-call messages to find CareGuard's last written reply", () => {
    const history: ChatCompletionMessageParam[] = [
      user("Bil apa ni?"),
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "log_document", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "Logged for the family timeline." },
      assistant("Ini bil TNB. Nak saya ingatkan awak nanti?"),
      user("Boleh"),
    ];
    expect(toolsForTurn(tools, history)).toHaveProperty("create_reminder");
  });
});

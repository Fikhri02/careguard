import type { ChatCompletionMessageParam, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/db.js";
import { fixedClock } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createConversationRepo } from "./repo.js";
import { createConversationService, HISTORY_LIMIT, stripImages } from "./service.js";

const user = (text: string): ChatCompletionUserMessageParam => ({ role: "user", content: [{ type: "text", text }] });

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const mak = createEldersService({ repo: createEldersRepo(db), clock }).findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  return { mak, conversation: createConversationService({ repo: createConversationRepo(db), clock }) };
}

describe("ConversationService", () => {
  it("returns an empty window for an elder with no messages", () => {
    const { mak, conversation } = setup();
    expect(conversation.window(mak.id)).toEqual([]);
  });

  it("persists messages in order", () => {
    const { mak, conversation } = setup();
    conversation.appendInbound(mak.id, user("Hai"), "SM1");
    conversation.append(mak.id, [{ role: "assistant", content: "Hai Mak!" }]);
    expect(conversation.window(mak.id)).toEqual([user("Hai"), { role: "assistant", content: "Hai Mak!" }]);
  });

  it("ignores a duplicate inbound message id", () => {
    const { mak, conversation } = setup();
    expect(conversation.appendInbound(mak.id, user("Hai"), "SM1")).toBe(true);
    expect(conversation.appendInbound(mak.id, user("Hai"), "SM1")).toBe(false);
    expect(conversation.appendInbound(mak.id, user("No id"))).toBe(true);
    expect(conversation.window(mak.id)).toHaveLength(2);
  });

  it("stores photos as [photo] text", () => {
    const { mak, conversation } = setup();
    conversation.appendInbound(mak.id, {
      role: "user",
      content: [
        { type: "text", text: "Bil apa ni?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    });
    expect(conversation.window(mak.id)).toEqual([
      { role: "user", content: [{ type: "text", text: "Bil apa ni?" }, { type: "text", text: "[photo]" }] },
    ]);
  });

  it("never starts the window in the middle of a tool exchange", () => {
    const { mak, conversation } = setup();
    // 10 exchanges × 4 messages = 40; the last 30 start at a `tool` message (index 10).
    for (let i = 0; i < 10; i++) {
      conversation.appendInbound(mak.id, user(`q${i}`));
      conversation.append(mak.id, [
        { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "log_document", arguments: "{}" } }] },
        { role: "tool", tool_call_id: `c${i}`, content: "ok" },
        { role: "assistant", content: `a${i}` },
      ]);
    }
    const window = conversation.window(mak.id);
    expect(window.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    expect(window[0]).toEqual(user("q3"));
    expect(window).toHaveLength(28);
  });

  it("leaves non-user messages untouched when stripping images", () => {
    const msg: ChatCompletionMessageParam = { role: "assistant", content: "x" };
    expect(stripImages(msg)).toBe(msg);
  });
});

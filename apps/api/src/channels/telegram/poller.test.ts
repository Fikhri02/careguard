import { describe, expect, it, vi } from "vitest";
import { createTelegramMessenger } from "../../adapters/telegram-messenger.js";
import { createInboundPipeline, type InboundResult, type InboundTurn } from "../../agent/pipeline.js";
import { buildTools } from "../../agent/registry.js";
import { createTurnQueue } from "../../agent/turn-queue.js";
import { assistantText, FakeLlm, silentLogger } from "../../test/fakes.js";
import { createTestServices } from "../../test/harness.js";
import type { TelegramClient, TelegramMessage, TelegramUpdate } from "./client.js";
import { createTelegramPoller, SHARE_BUTTON, WELCOME } from "./poller.js";

function fakeClient(updates: TelegramUpdate[][] = []) {
  const sent: { chatId: string | number; text: string; replyMarkup?: unknown }[] = [];
  const polls: number[] = [];
  const client: TelegramClient = {
    getUpdates: async (offset) => {
      polls.push(offset);
      return updates.shift() ?? [];
    },
    sendMessage: async (chatId, text, replyMarkup) => {
      sent.push({ chatId, text, replyMarkup });
      return true;
    },
    sendTyping: async () => {},
    downloadFile: async (fileId) => ({ bytes: Buffer.from(`bytes-of-${fileId}`), contentType: "image/jpeg" }),
    deleteWebhook: async () => {},
  };
  return { client, sent, polls };
}

const message = (overrides: Partial<TelegramMessage>): TelegramMessage => ({
  message_id: 10,
  chat: { id: 42 },
  from: { id: 42, first_name: "Mak" },
  ...overrides,
});

function setup(llm = FakeLlm.scripted([assistantText("Hai Mak!")])) {
  const t = createTestServices();
  const telegram = fakeClient();
  const messenger = createTelegramMessenger(telegram.client);
  const pipeline = createInboundPipeline({
    services: t.services,
    tools: buildTools({ ...t.services, search: t.search }),
    llm,
    queue: createTurnQueue(),
    clock: t.clock,
    log: silentLogger,
  });
  const handle = vi.fn((turn: InboundTurn): Promise<InboundResult> => pipeline.handle(turn));
  const poller = createTelegramPoller({
    client: telegram.client,
    pipeline: { handle },
    family: t.services.family,
    elders: t.services.elders,
    messenger,
    log: silentLogger,
    idleDelayMs: 1,
  });
  return { ...t, ...telegram, handle, poller, llm };
}

describe("Telegram poller", () => {
  it("answers /start with the welcome and a share-my-number button, without calling the model", async () => {
    const { poller, sent, handle } = setup();
    await poller.handleMessage(message({ text: "/start" }));
    expect(sent).toEqual([
      {
        chatId: "42",
        text: WELCOME,
        replyMarkup: { keyboard: [[{ text: SHARE_BUTTON, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
      },
    ]);
    expect(handle).not.toHaveBeenCalled();
  });

  it("links a family member who shares their own number", async () => {
    const { poller, sent, services } = setup();
    const mak = services.elders.findOrCreateByPhone("telegram:42", "Mak");
    services.family.register(mak.id, { phone: "012-345 6789", name: "Aisyah" });

    await poller.handleMessage(message({ chat: { id: 77 }, from: { id: 77, first_name: "Aisyah" }, contact: { phone_number: "60123456789", user_id: 77 } }));

    expect(services.family.list(mak.id)[0]!.telegramChatId).toBe("77");
    expect(sent.at(-1)).toMatchObject({ chatId: "77", replyMarkup: { remove_keyboard: true } });
    expect(sent.at(-1)!.text).toContain("if Mak receives a likely scam");
  });

  it("refuses someone else's forwarded contact card", async () => {
    const { poller, sent, services } = setup();
    const mak = services.elders.findOrCreateByPhone("telegram:42", "Mak");
    services.family.register(mak.id, { phone: "0123456789" });

    await poller.handleMessage(message({ chat: { id: 77 }, from: { id: 77 }, contact: { phone_number: "60123456789", user_id: 999 } }));

    expect(services.family.list(mak.id)[0]!.telegramChatId).toBeNull();
    expect(sent.at(-1)!.text).toContain("share your own number");
  });

  it("explains when a shared number isn't registered as family", async () => {
    const { poller, sent } = setup();
    await poller.handleMessage(message({ contact: { phone_number: "60199999999", user_id: 42 } }));
    expect(sent.at(-1)!.text).toContain("No one has saved this number");
  });

  it("runs a text message through the pipeline and replies in the same chat", async () => {
    const { poller, sent, handle, services } = setup();

    await poller.handleMessage(message({ text: "Hai" }));

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "telegram:42", name: "Mak", externalId: "tg:42:10", message: { role: "user", content: [{ type: "text", text: "Hai" }] } }),
    );
    expect(sent.at(-1)).toMatchObject({ chatId: "42", text: "Hai Mak!" });
    expect(services.elders.list()).toMatchObject([{ phone: "telegram:42", name: "Mak" }]);
  });

  it("sends the largest photo and its caption to the model", async () => {
    const { poller, handle } = setup(FakeLlm.scripted([assistantText("Ini bil TNB.")]));

    await poller.handleMessage(
      message({
        caption: "Bil apa ni?",
        photo: [
          { file_id: "small", width: 90, height: 90 },
          { file_id: "large", width: 1280, height: 1280 },
        ],
      }),
    );

    expect(handle.mock.calls[0]![0].message.content).toEqual([
      { type: "text", text: "Bil apa ni?" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from("bytes-of-large").toString("base64")}` } },
    ]);
  });

  it("polls from the next offset and handles each update", async () => {
    const t = createTestServices();
    const telegram = fakeClient([[{ update_id: 5, message: message({ text: "/start" }) }]]);
    const poller = createTelegramPoller({
      client: telegram.client,
      pipeline: { handle: vi.fn() },
      family: t.services.family,
      elders: t.services.elders,
      messenger: createTelegramMessenger(telegram.client),
      log: silentLogger,
      pollTimeoutSeconds: 0,
      idleDelayMs: 1,
    });

    poller.start();
    await vi.waitFor(() => expect(telegram.polls).toContain(6));
    await poller.stop();

    expect(telegram.polls[0]).toBe(0);
    expect(telegram.sent[0]!.text).toBe(WELCOME);
  });
});

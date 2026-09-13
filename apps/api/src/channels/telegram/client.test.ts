import { describe, expect, it, vi } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { createRoutingMessenger } from "../../adapters/routing-messenger.js";
import { createTelegramMessenger } from "../../adapters/telegram-messenger.js";
import { createTelegramClient } from "./client.js";

const TOKEN = "123456:SECRET-TOKEN-VALUE";
type FetchCall = [string, RequestInit | undefined];
const asFetch = (fn: (url: string, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;
const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));

function capturingLogger() {
  const lines: string[] = [];
  const push = (msg: string, meta?: object) => lines.push(`${msg} ${JSON.stringify(meta ?? {})}`);
  return { lines, log: { info: push, warn: push, error: push } };
}

describe("createTelegramClient", () => {
  it("long-polls getUpdates with the offset and returns the updates", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok([{ update_id: 7, message: { message_id: 1, chat: { id: 42 }, text: "Hai" } }]));
    const { log } = capturingLogger();
    const client = createTelegramClient({ token: TOKEN, fetch: asFetch(fetchMock) }, log);

    const updates = await client.getUpdates(7, 25);

    expect(updates).toEqual([{ update_id: 7, message: { message_id: 1, chat: { id: 42 }, text: "Hai" } }]);
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(JSON.parse(init!.body as string)).toEqual({ offset: 7, timeout: 25, allowed_updates: ["message"] });
  });

  it("returns [] when Telegram refuses, without leaking the token into logs", async () => {
    const { lines, log } = capturingLogger();
    const client = createTelegramClient(
      {
        token: TOKEN,
        fetch: asFetch(async () => {
          throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/getUpdates`);
        }),
      },
      log,
    );
    await expect(client.getUpdates(0, 1)).resolves.toEqual([]);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).toContain("[token]");
  });

  it("sends a message with an optional reply keyboard", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({ message_id: 9 }));
    const { log } = capturingLogger();
    const client = createTelegramClient({ token: TOKEN, fetch: asFetch(fetchMock) }, log);
    const keyboard = { keyboard: [[{ text: "Share my number", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

    await expect(client.sendMessage(42, "Hai Mak", keyboard)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toMatch(/\/sendMessage$/);
    expect(JSON.parse(init!.body as string)).toEqual({ chat_id: 42, text: "Hai Mak", reply_markup: keyboard });
  });

  it("reports a failed send as false", async () => {
    const { log } = capturingLogger();
    const client = createTelegramClient(
      { token: TOKEN, fetch: asFetch(async () => new Response(JSON.stringify({ ok: false, error_code: 403, description: "bot was blocked" }), { status: 403 })) },
      log,
    );
    await expect(client.sendMessage(42, "x")).resolves.toBe(false);
  });

  it("downloads a photo through getFile and the file URL", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/getFile")
        ? ok({ file_id: "F1", file_path: "photos/file_3.jpg" })
        : new Response(Buffer.from("jpegbytes"), { headers: { "content-type": "application/octet-stream" } }),
    );
    const { log } = capturingLogger();
    const client = createTelegramClient({ token: TOKEN, fetch: asFetch(fetchMock) }, log);

    const file = await client.downloadFile("F1");

    expect(file).toEqual({ bytes: Buffer.from("jpegbytes"), contentType: "image/jpeg" });
    expect((fetchMock.mock.calls[1] as FetchCall)[0]).toBe(`https://api.telegram.org/file/bot${TOKEN}/photos/file_3.jpg`);
  });
});

describe("Telegram messaging", () => {
  it("routes telegram: addresses to Telegram and everything else to the fallback", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({ message_id: 1 }));
    const { log } = capturingLogger();
    const telegram = createTelegramMessenger(createTelegramClient({ token: TOKEN, fetch: asFetch(fetchMock) }, log));
    const fallback = new CapturingMessenger();
    const messenger = createRoutingMessenger({ telegram, fallback });

    await expect(messenger.send({ to: "telegram:555001", body: "alert" })).resolves.toBe(true);
    await expect(messenger.send({ to: "whatsapp:+60123456789", body: "hai" })).resolves.toBe(true);

    expect(JSON.parse((fetchMock.mock.calls[0] as FetchCall)[1]!.body as string)).toMatchObject({ chat_id: "555001", text: "alert" });
    expect(fallback.sent).toEqual([{ to: "whatsapp:+60123456789", body: "hai" }]);
  });
});

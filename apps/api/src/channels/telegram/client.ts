import type { Logger } from "../../ports/logger.js";

export interface TelegramUser {
  id: number;
  first_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  contact?: { phone_number: string; first_name?: string; user_id?: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export type ReplyMarkup =
  | { keyboard: { text: string; request_contact?: boolean }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true };

export interface TelegramClient {
  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  sendMessage(chatId: string | number, text: string, replyMarkup?: ReplyMarkup): Promise<boolean>;
  sendTyping(chatId: string | number): Promise<void>;
  downloadFile(fileId: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  deleteWebhook(): Promise<void>;
}

/** Thin Telegram Bot API client. The token is part of every URL, so it is never logged. */
export function createTelegramClient(opts: { token: string; fetch?: typeof fetch }, log: Logger): TelegramClient {
  const doFetch = opts.fetch ?? fetch;
  const base = `https://api.telegram.org/bot${opts.token}`;
  const scrub = (text: string) => text.split(opts.token).join("[token]");

  async function call<T>(method: string, body: object, signal: AbortSignal): Promise<T | null> {
    try {
      const res = await doFetch(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
      if (!res.ok || !data?.ok) {
        log.warn("telegram call failed", { method, status: res.status, code: data?.error_code, reason: data?.description });
        return null;
      }
      return (data.result ?? null) as T | null;
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError" && signal.aborted && method === "getUpdates")) {
        log.warn("telegram call error", { method, error: scrub(err instanceof Error ? err.message : String(err)) });
      }
      return null;
    }
  }

  return {
    async getUpdates(offset, timeoutSeconds, signal) {
      const timeout = AbortSignal.timeout((timeoutSeconds + 10) * 1000);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const result = await call<TelegramUpdate[]>("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ["message"] }, combined);
      return result ?? [];
    },
    async sendMessage(chatId, text, replyMarkup) {
      const body = { chat_id: chatId, text: text.slice(0, 4096), ...(replyMarkup ? { reply_markup: replyMarkup } : {}) };
      return (await call<unknown>("sendMessage", body, AbortSignal.timeout(10_000))) !== null;
    },
    async sendTyping(chatId) {
      await call<unknown>("sendChatAction", { chat_id: chatId, action: "typing" }, AbortSignal.timeout(5_000));
    },
    async downloadFile(fileId) {
      const file = await call<{ file_path?: string }>("getFile", { file_id: fileId }, AbortSignal.timeout(10_000));
      if (!file?.file_path) return null;
      try {
        const res = await doFetch(`https://api.telegram.org/file/bot${opts.token}/${file.file_path}`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          log.warn("telegram file download failed", { status: res.status });
          return null;
        }
        const header = res.headers.get("content-type") ?? "";
        const extension = file.file_path.split(".").pop()?.toLowerCase();
        const contentType = header.startsWith("image/") ? header : extension === "png" ? "image/png" : "image/jpeg";
        return { bytes: Buffer.from(await res.arrayBuffer()), contentType };
      } catch (err) {
        log.warn("telegram file download error", { error: scrub(err instanceof Error ? err.message : String(err)) });
        return null;
      }
    },
    async deleteWebhook() {
      // Long polling and a webhook can't coexist; clear any webhook so getUpdates works.
      await call<unknown>("deleteWebhook", { drop_pending_updates: false }, AbortSignal.timeout(10_000));
    },
  };
}

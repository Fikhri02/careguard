import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ToolSet } from "./tool.js";

const MALAY_WORDS = /\b(yang|awak|anda|ini|ni|itu|tu|jangan|nak|saya|dan|untuk|dengan|tak|tidak|boleh|kalau|ya|sila)\b/gi;
const ENGLISH_WORDS = /\b(the|you|your|this|that|don't|do|and|to|is|please|if|with|not|call|it)\b/gi;
const WARNING_ONLY_LINE = /^🚨\s*(hati-hati|be careful)\s*[!.]*\s*$/i;

/**
 * The model sometimes keeps the Malay warning line on an English reply (seen in the eval).
 * When the first line is only the 🚨 warning, make it match the language of the rest of the reply.
 */
export function localizeWarningHeader(reply: string): string {
  const [first, ...rest] = reply.split("\n");
  if (!first || !WARNING_ONLY_LINE.test(first.trim())) return reply;
  const body = rest.join("\n");
  const malay = body.match(MALAY_WORDS)?.length ?? 0;
  const english = body.match(ENGLISH_WORDS)?.length ?? 0;
  const header = english > malay ? "🚨 Be careful" : "🚨 Hati-hati";
  return [header, ...rest].join("\n");
}

/**
 * The prompt is Malay-heavy, so the model drifts into Malay mid-reply for English speakers (seen in the eval).
 * Pins the reply language from the elder's recent messages together, so a Malay speaker forwarding an English
 * scam SMS still gets Malay. Returns null when it's too close to call.
 */
export function replyLanguageHint(history: ChatCompletionMessageParam[]): string | null {
  const recent = history.filter((m) => m.role === "user").slice(-6).map(textOf).join("\n");
  const malay = recent.match(MALAY_WORDS)?.length ?? 0;
  const english = recent.match(ENGLISH_WORDS)?.length ?? 0;
  if (Math.abs(malay - english) < 2) return null;
  const language = english > malay ? "English" : "Bahasa Melayu";
  const header = english > malay ? "🚨 Be careful" : "🚨 Hati-hati";
  return `The user writes in ${language}. Write the whole reply in ${language} only, including the "${header}" line and the offer to tell their family.`;
}

const REMINDER_WORDS =/\b(ingatkan|peringatan|remind|reminder)\b/i;

function textOf(message: ChatCompletionMessageParam | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join(" ");
  }
  return "";
}

/**
 * Consent guard: create_reminder is only available when CareGuard offered a reminder in its previous reply,
 * or the elder asks for one in this message. The prompt alone didn't stop the model setting reminders unasked.
 */
export function toolsForTurn(tools: ToolSet, history: ChatCompletionMessageParam[]): ToolSet {
  if (!tools.create_reminder) return tools;
  const current = history.at(-1);
  const previousReply = history
    .slice(0, -1)
    .reverse()
    .find((m) => m.role === "assistant" && textOf(m).trim().length > 0);
  if (REMINDER_WORDS.test(textOf(current)) || REMINDER_WORDS.test(textOf(previousReply))) return tools;
  const { create_reminder: _hiddenUntilOffered, ...rest } = tools;
  return rest;
}

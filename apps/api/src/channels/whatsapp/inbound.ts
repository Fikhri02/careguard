import type { ChatCompletionContentPart, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import type { MediaFetcher } from "../../adapters/twilio-media.js";

export interface TwilioInbound {
  from: string;
  body: string;
  messageSid: string | null;
  media: { url: string; contentType: string }[];
}

export function parseTwilioForm(form: Record<string, unknown>): TwilioInbound {
  const field = (key: string) => (typeof form[key] === "string" ? (form[key] as string) : "");
  const count = Number.parseInt(field("NumMedia") || "0", 10) || 0;
  const media: TwilioInbound["media"] = [];
  for (let i = 0; i < count; i++) {
    const url = field(`MediaUrl${i}`);
    if (url) media.push({ url, contentType: field(`MediaContentType${i}`) });
  }
  return { from: field("From"), body: field("Body").trim(), messageSid: field("MessageSid") || null, media };
}

export async function toUserMessage(inbound: TwilioInbound, fetchMedia: MediaFetcher): Promise<ChatCompletionUserMessageParam> {
  const parts: ChatCompletionContentPart[] = [];
  if (inbound.body) parts.push({ type: "text", text: inbound.body });
  for (const item of inbound.media) {
    if (!item.contentType.startsWith("image/")) continue;
    const dataUrl = await fetchMedia(item.url);
    if (dataUrl) parts.push({ type: "image_url", image_url: { url: dataUrl } });
  }
  if (parts.length === 0) parts.push({ type: "text", text: "(no content)" });
  return { role: "user", content: parts };
}

// Surface 3: Slack (a top "belongs somewhere new" target).
// Socket Mode = no public URL needed, perfect for a hackathon.
// Setup: api.slack.com/apps -> enable Socket Mode, add scopes
//   app_mentions:read, chat:write, im:history, im:read, im:write
// then subscribe to events: app_mention, message.im
import "dotenv/config";
import { App } from "@slack/bolt";
import { runAgent } from "../agent/agent.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

// Per-thread memory so conversations feel continuous.
const threads = new Map<string, ChatCompletionMessageParam[]>();

async function handle(text: string, threadKey: string, say: (m: string) => Promise<unknown>) {
  const history = threads.get(threadKey) ?? [];
  history.push({ role: "user", content: text });
  const { reply, history: updated } = await runAgent(history);
  threads.set(threadKey, updated);
  await say(reply || "…");
}

// @mention in a channel
app.event("app_mention", async ({ event, say }: any) => {
  const text = (event as any).text?.replace(/<@[^>]+>/g, "").trim() ?? "";
  const key = (event as any).thread_ts ?? (event as any).ts;
  await handle(text, key, (m) => say({ text: m, thread_ts: key }));
});

// Direct message
app.message(async ({ message, say }: any) => {
  const m = message as any;
  if (m.subtype || m.bot_id) return; // ignore edits / bots
  await handle(m.text ?? "", m.user, (t) => say(t));
});

const port = Number(process.env.PORT) || 3000;
await app.start(port);
console.log("⚡ Slack agent running (Socket Mode). Mention it or DM it.");

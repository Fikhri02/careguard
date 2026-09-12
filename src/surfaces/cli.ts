// Surface 1: terminal. `npm run cli` — fastest way to sanity-check your agent.
import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runAgent } from "../agent/agent.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const rl = readline.createInterface({ input: stdin, output: stdout });
const history: ChatCompletionMessageParam[] = [];

console.log("Agent CLI — type a message (Ctrl+C to quit)\n");

while (true) {
  const userText = await rl.question("you › ");
  if (!userText.trim()) continue;
  history.push({ role: "user", content: userText });
  const { reply, history: updated } = await runAgent(history, {
    onToolCall: (name) => console.log(`   …using ${name}`),
  });
  history.length = 0;
  history.push(...updated);
  console.log(`\nagent › ${reply}\n`);
}

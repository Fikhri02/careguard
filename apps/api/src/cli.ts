import "./load-env.js";
import * as readline from "node:readline";
import { CapturingMessenger } from "./adapters/capturing-messenger.js";
import { createConsoleLogger } from "./adapters/console-logger.js";
import { loadConfig } from "./infra/config.js";
import { createRuntime } from "./runtime.js";

const CLI_PHONE = "whatsapp:+60000000000";

const config = loadConfig({ ...process.env, NODE_ENV: "development" });
const runtime = createRuntime(config, createConsoleLogger({ minLevel: "warn" }));

console.log(`CareGuard CLI — chatting as ${CLI_PHONE}. Ctrl+D to quit.`);
if (config.fallbacks.length > 0) console.log(`Fallbacks active: ${config.fallbacks.join(", ")}`);

const rl = readline.createInterface({ input: process.stdin });
process.stdout.write("\nyou › ");

for await (const line of rl) {
  const text = line.trim();
  if (text) {
    // Nothing is sent from the CLI: replies and family alerts are captured and printed.
    const messenger = new CapturingMessenger();
    const result = await runtime.pipeline.handle({
      phone: CLI_PHONE,
      message: { role: "user", content: [{ type: "text", text }] },
      messenger,
      onToolCall: (name) => console.log(`   …using ${name}`),
    });
    for (const message of messenger.sent) {
      if (message.to === CLI_PHONE) console.log(`\ncareguard › ${message.body}`);
      else console.log(`   ↗ WhatsApp to ${message.to}: ${message.body}`);
    }
    for (const event of result.events) console.log(`   • [${event.severity}] ${event.type}: ${event.summary}`);
  }
  process.stdout.write("\nyou › ");
}

runtime.close();

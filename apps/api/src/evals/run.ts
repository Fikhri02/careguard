import "../load-env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import { loadConfig } from "../infra/config.js";
import { createRuntime } from "../runtime.js";
import type { CheckResult, TurnRecord } from "./checks.js";
import { createJudge } from "./judge.js";
import { SCENARIOS } from "./scenarios.js";

/**
 * Runs each scenario through the real pipeline and model, then scores the replies.
 *   npm run eval                    all scenarios, with the LLM judge
 *   npm run eval -- --only scam-ms  one scenario
 *   npm run eval -- --no-judge      free deterministic checks only
 * Nothing is sent: turns use a capturing messenger, and WhatsApp/Telegram are switched off.
 */

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const useJudge = !args.includes("--no-judge");
const silent = { info() {}, warn() {}, error() {} };
const ELDER_PHONE = "whatsapp:+60100000001";

// Strip messaging credentials so the eval can never reach a real phone, even via reminder nudges.
const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test", DATABASE_PATH: ":memory:" };
for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TELEGRAM_BOT_TOKEN", "PUBLIC_URL"]) delete env[key];
const config = loadConfig(env);
if (!config.openai) {
  console.error("OPENAI_API_KEY is not set — the eval needs a real model.");
  process.exit(2);
}

const judgeModel = process.env.EVAL_JUDGE_MODEL ?? "openai/gpt-4.1-mini";
const judge = useJudge ? createJudge({ apiKey: config.openai.apiKey, baseUrl: config.openai.baseUrl, model: judgeModel }) : null;
const scenarios = SCENARIOS.filter((s) => !only || s.id === only);
if (scenarios.length === 0) {
  console.error(`No scenario with id "${only}". Ids: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  process.exit(2);
}

console.log(`CareGuard reply eval — model ${config.model}${judge ? ` · judge ${judgeModel}` : " · no judge"} · ${scenarios.length} scenario(s)\n`);

const report: { id: string; title: string; turns: TurnRecord[]; results: CheckResult[] }[] = [];

for (const scenario of scenarios) {
  const runtime = createRuntime(config, silent);
  const turns: TurnRecord[] = [];
  try {
    if (scenario.familyPhone) {
      const elder = runtime.services.elders.findOrCreateByPhone(ELDER_PHONE, null);
      runtime.services.family.register(elder.id, { phone: scenario.familyPhone, name: "Aisyah" });
    }
    for (const text of scenario.turns) {
      const messenger = new CapturingMessenger();
      const tools: string[] = [];
      const result = await runtime.pipeline.handle({
        phone: ELDER_PHONE,
        message: { role: "user", content: [{ type: "text", text }] },
        messenger,
        onToolCall: (name) => tools.push(name),
      });
      turns.push({
        user: text,
        reply: result.reply ?? "",
        tools,
        events: result.events.map((e) => ({ type: e.type, severity: e.severity })),
        sent: messenger.sent,
      });
    }

    const last = turns.at(-1)!;
    const results = [...scenario.checks(last, turns)];
    if (judge) {
      try {
        results.push(...(await judge.score(scenario, turns)));
      } catch (err) {
        results.push({ rule: "judge: responded", pass: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    report.push({ id: scenario.id, title: scenario.title, turns, results });

    const passed = results.filter((r) => r.pass).length;
    console.log(`━━ ${scenario.title}  [${scenario.id}]  ${passed}/${results.length}`);
    console.log(`   reply: ${last.reply.replace(/\n+/g, " ⏎ ").slice(0, 240)}`);
    for (const r of results) {
      console.log(`   ${r.pass ? "✓" : "✗"}${r.safety ? " [safety]" : ""} ${r.rule} — ${r.detail}`);
    }
    console.log("");
  } finally {
    runtime.close();
  }
}

const all = report.flatMap((r) => r.results);
const passed = all.filter((r) => r.pass).length;
const safetyFailures = all.filter((r) => r.safety && !r.pass);
console.log(`Overall: ${passed}/${all.length} checks passed (${Math.round((passed / Math.max(all.length, 1)) * 100)}%)`);
console.log(safetyFailures.length === 0 ? "Safety: all safety checks passed" : `Safety: ${safetyFailures.length} FAILED`);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "eval-results");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(outFile, JSON.stringify({ model: config.model, judge: judge ? judgeModel : null, passed, total: all.length, report }, null, 2));
console.log(`Saved ${outFile}`);

// A scheduled reminder would keep the process alive; the eval is finished.
process.exit(safetyFailures.length === 0 ? 0 : 1);

import "./load-env.js";
import { createConsoleLogger } from "./adapters/console-logger.js";
import { ConfigError, loadConfig, type Config } from "./infra/config.js";
import { seedDemo } from "./infra/seed.js";
import { createRuntime } from "./runtime.js";

const log = createConsoleLogger();

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const config = loadConfigOrExit();
const runtime = createRuntime(config, log);

if (config.seedDemo && seedDemo(runtime.services)) log.info("seeded demo data");
const restoredReminders = runtime.services.reminders.restorePending();

const server = runtime.app.listen(config.port, () => {
  log.info("CareGuard API listening", { port: config.port, env: config.env, fallbacks: config.fallbacks, restoredReminders });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  server.close();
  await Promise.race([runtime.pipeline.idle(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  server.closeAllConnections(); // open SSE streams would otherwise keep the process alive
  runtime.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

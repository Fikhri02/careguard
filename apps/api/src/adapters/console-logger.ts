import type { LogMeta, Logger } from "../ports/logger.js";

type Level = "info" | "warn" | "error";
const ORDER: Record<Level, number> = { info: 20, warn: 30, error: 40 };

/** JSON-lines logger (Cloud Run parses these into structured logs). */
export function createConsoleLogger({ minLevel = "info" }: { minLevel?: Level } = {}): Logger {
  const emit = (level: Level) => (msg: string, meta: LogMeta = {}) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = JSON.stringify({ severity: level.toUpperCase(), msg, time: new Date().toISOString(), ...meta });
    if (level === "info") console.log(line);
    else console.error(line);
  };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}

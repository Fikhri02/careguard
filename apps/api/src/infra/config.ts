import { z } from "zod";

export class ConfigError extends Error {
  name = "ConfigError";
}

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  databasePath: string;
  publicUrl?: string;
  dashboardOrigin: string;
  model: string;
  seedDemo: boolean;
  openai?: { apiKey: string; baseUrl?: string };
  twilio?: { accountSid: string; authToken: string; from: string };
  exaApiKey?: string;
  safeBrowsingKey?: string;
  /** Integrations running in degraded mode, e.g. "search:null". Logged at startup and on /health. */
  fallbacks: string[];
}

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/careguard.db"),
  PUBLIC_URL: z.url().optional(),
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),
  MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  GOOGLE_SAFE_BROWSING_KEY: z.string().optional(),
  SEED_DEMO: z.enum(["true", "false", "1", "0"]).optional(),
});

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  // Blank values in .env (e.g. "EXA_API_KEY=") mean "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) throw new ConfigError(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;

  if (e.NODE_ENV === "production") {
    const missing = (
      ["OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "PUBLIC_URL"] as const
    ).filter((key) => !e[key]);
    if (missing.length > 0) throw new ConfigError(`Missing required production settings: ${missing.join(", ")}`);
  }

  const openai = e.OPENAI_API_KEY ? { apiKey: e.OPENAI_API_KEY, baseUrl: e.OPENAI_BASE_URL } : undefined;
  const twilio =
    e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_WHATSAPP_FROM
      ? { accountSid: e.TWILIO_ACCOUNT_SID, authToken: e.TWILIO_AUTH_TOKEN, from: e.TWILIO_WHATSAPP_FROM }
      : undefined;

  const fallbacks: string[] = [];
  if (!openai) fallbacks.push("llm:disabled");
  if (!twilio) fallbacks.push("messenger:console");
  if (!twilio || !e.PUBLIC_URL) fallbacks.push("twilio-signature:off");
  if (!e.EXA_API_KEY) fallbacks.push("search:null");
  if (!e.GOOGLE_SAFE_BROWSING_KEY) fallbacks.push("url-reputation:offline");

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicUrl: e.PUBLIC_URL,
    dashboardOrigin: e.DASHBOARD_ORIGIN,
    model: e.MODEL,
    seedDemo: e.SEED_DEMO === "true" || e.SEED_DEMO === "1",
    openai,
    twilio,
    exaApiKey: e.EXA_API_KEY,
    safeBrowsingKey: e.GOOGLE_SAFE_BROWSING_KEY,
    fallbacks,
  };
}

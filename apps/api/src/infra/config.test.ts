import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const TWILIO = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
};

describe("loadConfig", () => {
  it("boots with no keys and reports every fallback", () => {
    const c = loadConfig({});
    expect(c.env).toBe("development");
    expect(c.port).toBe(8787);
    expect(c.databasePath).toBe("./data/careguard.db");
    expect(c.dashboardOrigin).toBe("http://localhost:3000");
    expect(c.model).toBe("gpt-4o-mini");
    expect(c.seedDemo).toBe(false);
    expect(c.openai).toBeUndefined();
    expect(c.twilio).toBeUndefined();
    expect(c.fallbacks).toEqual([
      "llm:disabled",
      "messenger:console",
      "twilio-signature:off",
      "search:null",
      "url-reputation:offline",
    ]);
  });

  it("treats empty strings as absent", () => {
    const c = loadConfig({ EXA_API_KEY: "", PORT: "  " });
    expect(c.exaApiKey).toBeUndefined();
    expect(c.port).toBe(8787);
  });

  it("enables Twilio only when all three values are set", () => {
    expect(loadConfig({ TWILIO_ACCOUNT_SID: "AC123" }).twilio).toBeUndefined();
    expect(loadConfig(TWILIO).twilio).toEqual({
      accountSid: "AC123",
      authToken: "tok",
      from: "whatsapp:+14155238886",
    });
  });

  it("keeps signature checking off until PUBLIC_URL is set", () => {
    expect(loadConfig(TWILIO).fallbacks).toContain("twilio-signature:off");
    expect(loadConfig({ ...TWILIO, PUBLIC_URL: "https://x.example" }).fallbacks).not.toContain("twilio-signature:off");
  });

  it("parses SEED_DEMO", () => {
    expect(loadConfig({ SEED_DEMO: "true" }).seedDemo).toBe(true);
    expect(loadConfig({ SEED_DEMO: "false" }).seedDemo).toBe(false);
  });

  it("refuses to start in production without required settings", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/OPENAI_API_KEY.*TWILIO_AUTH_TOKEN.*PUBLIC_URL/);
  });

  it("starts in production when required settings are present", () => {
    const c = loadConfig({ NODE_ENV: "production", OPENAI_API_KEY: "sk-test", PUBLIC_URL: "https://x.example", ...TWILIO });
    expect(c.env).toBe("production");
    expect(c.openai).toEqual({ apiKey: "sk-test", baseUrl: undefined });
  });

  it("rejects an invalid PUBLIC_URL", () => {
    expect(() => loadConfig({ PUBLIC_URL: "not a url" })).toThrow(ConfigError);
  });
});

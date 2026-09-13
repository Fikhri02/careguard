import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_REPLY } from "./agent/pipeline.js";
import { loadConfig } from "./infra/config.js";
import { createRuntime } from "./runtime.js";
import { silentLogger } from "./test/fakes.js";

const bareConfig = () => loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:" });

describe("createRuntime", () => {
  it("boots with no API keys, reports fallbacks, and answers with the fallback reply", async () => {
    const runtime = createRuntime(bareConfig(), silentLogger);
    try {
      const health = await request(runtime.app).get("/health");
      expect(health.body).toEqual({
        ok: true,
        db: true,
        fallbacks: ["llm:disabled", "messenger:console", "twilio-signature:off", "search:null", "url-reputation:offline"],
      });

      const sim = await request(runtime.app).post("/dev/simulate").send({ phone: "+60123456789", text: "Hai" });
      expect(sim.status).toBe(200);
      expect(sim.body).toEqual({
        reply: FALLBACK_REPLY,
        sent: [{ to: "whatsapp:+60123456789", body: FALLBACK_REPLY }],
        events: [],
      });
    } finally {
      runtime.close();
    }
  });

  it("accepts an unsigned webhook when Twilio is not configured and processes it in the background", async () => {
    const runtime = createRuntime(bareConfig(), silentLogger);
    try {
      const res = await request(runtime.app)
        .post("/whatsapp")
        .type("form")
        .send({ From: "whatsapp:+60123456789", Body: "Hai", MessageSid: "SM1" });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(runtime.services.elders.list()).toHaveLength(1));
      await runtime.pipeline.idle();
    } finally {
      runtime.close();
    }
  });
});

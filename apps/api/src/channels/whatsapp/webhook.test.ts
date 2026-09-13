import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { noMedia } from "../../adapters/twilio-media.js";
import { createInboundPipeline, type InboundResult, type InboundTurn } from "../../agent/pipeline.js";
import { buildTools } from "../../agent/registry.js";
import { createTurnQueue } from "../../agent/turn-queue.js";
import { createApp } from "../../http/app.js";
import { assistantText, assistantToolCall, FakeLlm, silentLogger } from "../../test/fakes.js";
import { createTestServices, testConfig } from "../../test/harness.js";
import { TWILIO_FIXTURE as F } from "../../test/twilio-fixture.js";
import { createSimulateHandler } from "../simulate.js";
import { createWhatsAppWebhook, EMPTY_TWIML } from "./webhook.js";

function setupWebhook({ signed = true } = {}) {
  const t = createTestServices();
  // A turn that never finishes: proves the webhook does not wait for the agent.
  const handle = vi.fn((_turn: InboundTurn) => new Promise<InboundResult>(() => {}));
  const whatsappWebhook = createWhatsAppWebhook({
    pipeline: { handle },
    messenger: t.messenger,
    fetchMedia: noMedia,
    log: silentLogger,
    signature: signed ? { authToken: F.authToken, publicUrl: F.publicUrl } : undefined,
  });
  const app = createApp({
    config: testConfig(),
    log: silentLogger,
    services: t.services,
    checkDb: () => true,
    whatsappWebhook,
    simulate: (_req, res) => {
      res.status(501).end();
    },
  });
  return { app, handle };
}

describe("POST /whatsapp", () => {
  it("acknowledges a signed webhook immediately and hands the turn to the pipeline", async () => {
    const { app, handle } = setupWebhook();

    const res = await request(app).post("/whatsapp").set("X-Twilio-Signature", F.signature).type("form").send(F.params);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/xml/);
    expect(res.text).toBe(EMPTY_TWIML);
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    expect(handle.mock.calls[0]![0]).toMatchObject({
      phone: "whatsapp:+60123456789",
      externalId: "SM11111111111111111111111111111111",
      message: { role: "user", content: [{ type: "text", text: "Maybank: akaun anda disekat" }] },
    });
  });

  it("rejects an invalid signature", async () => {
    const { app, handle } = setupWebhook();
    const res = await request(app).post("/whatsapp").set("X-Twilio-Signature", "bogus").type("form").send(F.params);
    expect(res.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects a request whose parameters were altered", async () => {
    const { app } = setupWebhook();
    const res = await request(app)
      .post("/whatsapp")
      .set("X-Twilio-Signature", F.signature)
      .type("form")
      .send({ ...F.params, Body: "changed" });
    expect(res.status).toBe(403);
  });

  it("accepts unsigned requests when signature checking is off", async () => {
    const { app, handle } = setupWebhook({ signed: false });
    expect((await request(app).post("/whatsapp").type("form").send(F.params)).status).toBe(200);
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
  });

  it("rejects a request without From", async () => {
    const { app } = setupWebhook({ signed: false });
    expect((await request(app).post("/whatsapp").type("form").send({ Body: "x" })).status).toBe(400);
  });
});

describe("POST /dev/simulate", () => {
  function setupSimulate(llm: FakeLlm) {
    const t = createTestServices();
    const pipeline = createInboundPipeline({
      services: t.services,
      tools: buildTools({ ...t.services, search: t.search }),
      llm,
      queue: createTurnQueue(),
      clock: t.clock,
      log: silentLogger,
    });
    const app = createApp({
      config: testConfig(),
      log: silentLogger,
      services: t.services,
      checkDb: () => true,
      whatsappWebhook: (_req, res) => {
        res.status(501).end();
      },
      simulate: createSimulateHandler(pipeline),
    });
    return { ...t, app };
  }

  it("runs the real pipeline and captures every outbound message instead of sending it", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("register_family", { phone: "0123456789", name: "Aisyah" }, "c1"),
      assistantToolCall("notify_family", { summary: "fake Maybank SMS" }, "c2"),
      assistantText("Dah beritahu Aisyah."),
    ]);
    const { app, messenger, services } = setupSimulate(llm);

    const res = await request(app).post("/dev/simulate").send({ phone: "+60 19-999 9999", text: "Tolong beritahu anak saya" });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("Dah beritahu Aisyah.");
    expect(res.body.sent.map((m: { to: string }) => m.to)).toEqual(["+60123456789", "whatsapp:+60199999999"]);
    expect(res.body.events).toEqual([]);
    expect(messenger.sent).toEqual([]);
    expect(services.elders.list()[0]!.phone).toBe("whatsapp:+60199999999");
  });

  it("validates the request body", async () => {
    const { app } = setupSimulate(FakeLlm.scripted([]));
    const res = await request(app).post("/dev/simulate").send({ phone: "+60123456789" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});

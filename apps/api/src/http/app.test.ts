import type { RequestHandler } from "express";
import request from "supertest";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import { describe, expect, it } from "vitest";
import { REASSURANCE } from "../modules/events/service.js";
import { silentLogger } from "../test/fakes.js";
import { createTestServices, testConfig } from "../test/harness.js";
import { createApp } from "./app.js";

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  OPENAI_API_KEY: "sk-test",
  PUBLIC_URL: "https://x.example",
  TWILIO_ACCOUNT_SID: "AC1",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
};

function setup(env: Record<string, string> = {}) {
  const t = createTestServices();
  const whatsappWebhook: RequestHandler = (_req, res) => {
    res.status(204).end();
  };
  const simulate: RequestHandler = (_req, res) => {
    res.json({ simulated: true });
  };
  const config = testConfig(env);
  const app = createApp({ config, log: silentLogger, services: t.services, checkDb: () => true, whatsappWebhook, simulate });
  const mak = t.services.elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  return { ...t, app, config, mak };
}

const scam = (elderId: string) => ({ elderId, type: "scam_detected" as const, severity: "high" as const, summary: "Likely scam" });

describe("HTTP app", () => {
  it("reports health with active fallbacks", async () => {
    const { app, config } = setup();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true, fallbacks: config.fallbacks });
  });

  it("lists and fetches elders", async () => {
    const { app, mak } = setup();
    expect((await request(app).get("/api/elders")).body.elders.map((e: { name: string }) => e.name)).toEqual(["Mak"]);
    expect((await request(app).get(`/api/elders/${mak.id}`)).body).toEqual(mak);
    const missing = await request(app).get("/api/elders/eld_missing");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: "not_found", message: "Elder eld_missing not found" } });
  });

  it("filters events", async () => {
    const { app, services, mak } = setup();
    services.events.record(scam(mak.id));
    services.events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });

    expect((await request(app).get("/api/events")).body.events).toHaveLength(2);
    expect((await request(app).get("/api/events?severity=high")).body.events).toHaveLength(1);
    expect((await request(app).get(`/api/events?elderId=${mak.id}&status=new`)).body.events).toHaveLength(2);
  });

  it("rejects invalid filters with a validation error", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/events?status=open");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("labels a Telegram person as an elder's family, so scam alerts reach their chat", async () => {
    const { app, services, mak } = setup();
    const son = services.elders.findOrCreateByPhone("telegram:555001", "Irfan");

    const res = await request(app).post("/api/family").send({ personId: son.id, elderId: mak.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ elderId: mak.id, name: "Irfan", phone: "telegram:555001", telegramChatId: "555001" });
    expect((await request(app).get("/api/family")).body.family).toHaveLength(1);

    const alerts = new CapturingMessenger();
    await services.family.notify(mak, "fake Maybank SMS", alerts);
    expect(alerts.sent.map((m) => m.to)).toEqual(["telegram:555001"]);

    expect((await request(app).post("/api/family").send({ personId: mak.id, elderId: mak.id })).status).toBe(400);
    expect((await request(app).post("/api/family").send({ personId: "eld_missing", elderId: mak.id })).status).toBe(404);
  });

  it("sends a family message to the elder, and rejects empty text or an unknown elder", async () => {
    const { app, messenger, mak } = setup();

    const sent = await request(app).post(`/api/elders/${mak.id}/messages`).send({ text: " Mak, saya call malam ni ya. " });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ delivered: true });
    expect(messenger.sent).toEqual([{ to: mak.phone, body: "💙 Daripada keluarga awak:\nMak, saya call malam ni ya." }]);

    expect((await request(app).post(`/api/elders/${mak.id}/messages`).send({ text: "  " })).status).toBe(400);
    expect((await request(app).post("/api/elders/eld_missing/messages").send({ text: "Hai" })).status).toBe(404);
    expect(messenger.sent).toHaveLength(1);
  });

  it("approves once, reassures the elder, and returns 409 on repeat", async () => {
    const { app, services, messenger, mak } = setup();
    const event = services.events.record(scam(mak.id));

    const first = await request(app).post(`/api/events/${event.id}/approve`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: event.id, status: "approved" });
    expect(messenger.sent).toEqual([{ to: mak.phone, body: REASSURANCE }]);

    const second = await request(app).post(`/api/events/${event.id}/approve`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("conflict");
    expect(messenger.sent).toHaveLength(1);
  });

  it("dismisses an event", async () => {
    const { app, services, mak } = setup();
    const event = services.events.record(scam(mak.id));
    const res = await request(app).post(`/api/events/${event.id}/dismiss`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("dismissed");
  });

  it("returns 404 for an unknown event", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/events/evt_missing")).status).toBe(404);
    expect((await request(app).post("/api/events/evt_missing/approve")).status).toBe(404);
  });

  it("lists reminders for an elder", async () => {
    const { app, services, mak } = setup();
    services.reminders.create(mak, { what: "Pay TNB bill", dueText: "Friday" });
    const res = await request(app).get(`/api/reminders?elderId=${mak.id}`);
    expect(res.body.reminders).toMatchObject([{ what: "Pay TNB bill", dueText: "Friday" }]);
  });

  it("allows the dashboard origin and answers preflight", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/events");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect((await request(app).options("/api/events")).status).toBe(204);
  });

  it("returns the JSON error shape for unknown routes", async () => {
    const { app } = setup();
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("rejects malformed JSON with 400", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/events/evt_x/approve").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("mounts the WhatsApp webhook and the dev simulator outside production", async () => {
    const { app } = setup();
    expect((await request(app).post("/whatsapp").type("form").send({ From: "whatsapp:+60123456789" })).status).toBe(204);
    expect((await request(app).post("/dev/simulate").send({})).body).toEqual({ simulated: true });
  });

  it("does not expose the simulator in production", async () => {
    const { app } = setup(PRODUCTION_ENV);
    expect((await request(app).post("/dev/simulate").send({})).status).toBe(404);
  });
});

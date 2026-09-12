// Surface 2: HTTP endpoint. Powers the web widget, a browser extension,
// a mobile app, a voice frontend — anything that can POST JSON.
// Deploy straight to Google Cloud Run (sponsor): `gcloud run deploy`.
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent } from "../agent/agent.js";
import { listEvents, getEvent, setStatus, type EventStatus } from "../agent/events.js";
import { remindersOf } from "../agent/careguard/reminders.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS so the family dashboard / a browser extension / static widget can call it.
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "content-type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

// Serve the demo widget at /
const here = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(here, "..", "web")));

app.get("/health", (_req, res) => res.json({ ok: true }));

// POST { messages: [{role, content}, ...] } -> { reply, messages }
app.post("/agent", async (req, res) => {
  try {
    const history = (req.body?.messages ?? []) as ChatCompletionMessageParam[];
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: "Send { messages: [{role, content}] }" });
    }
    const { reply, history: updated } = await runAgent(history);
    res.json({ reply, messages: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---- Events API — the contract the family dashboard (CopilotKit) reads/writes ----
// GET  /api/events?status=new          list events (newest first), optional status filter
// GET  /api/reminders                  list all reminders
// POST /api/events/:id/approve         family approves a high-risk event
// POST /api/events/:id/dismiss         family dismisses an event

app.get("/api/events", (req, res) => {
  const status = req.query.status as EventStatus | undefined;
  res.json({ events: listEvents(status ? { status } : undefined) });
});

app.get("/api/events/:id", (req, res) => {
  const e = getEvent(req.params.id);
  return e ? res.json(e) : res.status(404).json({ error: "not found" });
});

app.post("/api/events/:id/approve", (req, res) => {
  const e = setStatus(req.params.id, "approved");
  // TODO (build live): trigger the agent to act on approval (e.g. reassure the elder).
  return e ? res.json(e) : res.status(404).json({ error: "not found" });
});

app.post("/api/events/:id/dismiss", (req, res) => {
  const e = setStatus(req.params.id, "dismissed");
  return e ? res.json(e) : res.status(404).json({ error: "not found" });
});

app.get("/api/reminders", (_req, res) => {
  const all = [...remindersOf.entries()].flatMap(([elderId, list]) =>
    list.map((r) => ({ elderId, ...r })),
  );
  res.json({ reminders: all });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Agent server on http://localhost:${port}  (widget /, agent POST /agent, events /api/events)`);
});

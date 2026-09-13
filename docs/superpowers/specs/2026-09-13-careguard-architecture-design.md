# CareGuard — Architecture Design

**Date:** 2026-09-13 · **Status:** Approved in brainstorming, pending spec review · **Branch:** `feature/architecture`

## 1. Goal

Restructure the starter scaffold into a modular monolith that can carry CareGuard's core loop —
*scam on WhatsApp → HIGH event on the family dashboard → family approval flows back to the elder* —
reliably, testably, and with room for the event-day integrations (CopilotKit, Auth0, Trigger.dev).

The product brief (`README.md`) is unchanged and remains the source of truth for *what* CareGuard does.
This document defines *how the code is shaped*.

### Problems in the current scaffold this design fixes

| # | Problem | Fixed by |
|---|---|---|
| P1 | `careguard.ts` (8788) and `server.ts` (8787) are separate processes with separate in-memory event stores — the dashboard can never see a scam detected on WhatsApp | One API process + SQLite (§3, §5) |
| P2 | `currentUser` is a module-level global — concurrent elders cross-contaminate events and family alerts | Per-turn `ToolContext` (§6) |
| P3 | `npm run cli` uses the generic starter prompt and every tool, including the iPhone ones | CLI rebuilt on the simulate path (§8) |
| P4 | No outbound path from the server to the elder; approve is a TODO | `Messenger` port + `events.approve()` (§5, §7) |
| P5 | Webhook has no Twilio signature check and replies synchronously inside Twilio's ~15 s timeout | Signature validation + ack-then-process (§8) |
| P6 | Legacy code from earlier ideas is entangled in the tool registry | Deleted (§12) |

### Decisions already made

- **Language:** stay on TypeScript. Trigger.dev tasks and the CopilotKit runtime are TypeScript/Node, and the dashboard is Next.js — a .NET backend would add a second language and hand-synced contracts.
- **Storage:** SQLite via `better-sqlite3` (Node 22.13's built-in `node:sqlite` is still experimental).
- **Layout:** one repo, npm workspaces — Express API + Next.js dashboard + shared contracts.
- **Process:** foundation is committed on `feature/architecture`; event features go on `feature/careguard-core` and stay uncommitted.

## 2. Repository layout

```
careguard/
├── package.json                  workspaces: apps/*, packages/*; engines node >=22
├── tsconfig.base.json
├── Dockerfile                    multi-stage, builds @careguard/api
├── .github/workflows/ci.yml      typecheck + test on push
├── docs/superpowers/specs/       this document
├── packages/
│   └── shared/                   @careguard/shared — zod schemas + inferred types
│       └── src/{elder,family,event,reminder,api}.ts · index.ts
└── apps/
    ├── api/                      @careguard/api — the single backend process
    │   └── src/
    │       ├── main.ts           composition root: config → db → adapters → modules → http
    │       ├── cli.ts            terminal tester over the simulate path
    │       ├── http/             app.ts (express), errors.ts, cors.ts, require-family.ts, sse.ts
    │       ├── agent/            runner.ts, tool.ts (Tool/ToolContext types), registry.ts,
    │       │                     turn-queue.ts, prompts/careguard.ts
    │       ├── channels/whatsapp/  webhook.ts, signature.ts, inbound.ts (Twilio → content parts)
    │       ├── modules/
    │       │   ├── elders/       repo · service · routes
    │       │   ├── family/       repo · service · tools
    │       │   ├── protect/      service · patterns · urlcheck · tools   (no repo — stateless)
    │       │   ├── understand/   service · tools
    │       │   ├── reminders/    repo · service · tools · routes
    │       │   ├── events/       repo · service · routes · bus
    │       │   └── conversation/ repo · service
    │       ├── ports/            llm.ts, messenger.ts, search.ts, url-reputation.ts, scheduler.ts, clock.ts
    │       ├── adapters/         openai-llm, twilio-messenger, console-messenger, exa-search,
    │       │                     null-search, safe-browsing, in-process-scheduler, system-clock
    │       ├── infra/            config.ts, db.ts, migrations/NNN_*.sql, seed.ts
    │       └── test/             fakes (fake-llm, fake-messenger, fake-search, fixed-clock), helpers
    └── dashboard/                @careguard/dashboard — Next.js (App Router) shell
        └── app/ · lib/api.ts
```

Workspaces consume `@careguard/shared` as TypeScript source — no build step (`tsx` for the API,
`transpilePackages` for Next.js).

## 3. Runtime shape

```
 Elder ─WhatsApp─▶ Twilio ─POST /whatsapp─▶ ┌───────────── apps/api (one process) ─────────────┐
                                            │ channels/whatsapp: verify sig · resolve elder ·    │
                                            │ persist inbound · 200 OK ──┐                       │
                                            │                            ▼ (async, per-elder)    │
                                            │ agent/runner ── tools(ctx) ──▶ modules/*           │
                                            │                                   │   │            │
                                            │ infra/db (SQLite) ◀───────────────┘   └─▶ Messenger ─┼─▶ Twilio ─▶ Elder / Family
                                            │ http /api/* + /api/stream (SSE) ◀──────────────────┤
                                            └──────────────────────────────▲───────────────────┘
                                                                           │
                                            Family ─▶ apps/dashboard (Next.js + CopilotKit)
```

**Inbound flow**
1. **Accept** — `POST /whatsapp` verifies the Twilio signature, finds-or-creates the elder by `From`,
   de-duplicates on `MessageSid`, persists the inbound message, responds `200` with empty TwiML.
2. **Think** — the turn is enqueued on the elder's turn queue. The runner loads history, builds
   `ToolContext`, and runs the LLM tool loop with the CareGuard prompt.
3. **Act** — tools call module services; services write events and send via `Messenger`. The
   assistant's final reply is sent to the elder via `Messenger` (not the webhook response).
4. **Family** — the dashboard reads `/api/events`, receives live updates on `/api/stream`, and
   approves via `POST /api/events/:id/approve`, which sends the elder a reassurance via `Messenger`.

**Cloud Run constraint:** because work continues after the response, deploy with
`--no-cpu-throttling` and `--max-instances=1` (the latter also keeps SQLite single-writer).

## 4. Shared contracts (`packages/shared`)

zod schemas are the single definition; types are `z.infer`. The API validates with the schemas;
the dashboard imports the types.

```ts
EventType   = "bill_explained" | "scam_detected" | "high_risk_action" | "reminder_created"
Severity    = "low" | "med" | "high"
EventStatus = "new" | "approved" | "dismissed" | "resolved"

Elder        { id, phone, name: string|null, language: string|null, createdAt }
FamilyMember { id, elderId, name: string|null, phone, createdAt }          // auth0Sub not exposed
CareEvent    { id, elderId, type, severity, summary, detail: Record<string,unknown>,
               status, createdAt, resolvedAt: string|null, resolvedBy: string|null }
Reminder     { id, elderId, what, dueText, dueAt: string|null,
               status: "scheduled"|"sent"|"cancelled", createdAt }

ListEventsQuery { elderId?, status?, severity?, since? }
ApiError        { error: { code: string, message: string } }
StreamMessage   { type: "event.created"|"event.updated", event: CareEvent }
```

`bill_explained` is kept from the README contract and covers any explained document; the document
kind lives in `detail.kind` (`bill` | `letter` | `appointment` | `other`).

`high_risk_action` is in the contract for the README's escalation model, but **no foundation tool
records it** — the dashboard must still render it. `Elder.language` is nullable and **not written
by the foundation**; it is reserved for event-day prompt tuning.

## 5. Data model (SQLite)

Migrations are plain SQL files in `apps/api/src/infra/migrations/`, applied in filename order at
startup and recorded in `schema_migrations`. All ids are `TEXT` (`<prefix>_<uuid>`: `eld_`, `fam_`,
`evt_`, `rem_`) except `messages.id`; all timestamps are ISO-8601 `TEXT`. Foreign keys are enforced
(`PRAGMA foreign_keys = ON`); WAL mode on.

```sql
CREATE TABLE elders (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT, language TEXT, created_at TEXT NOT NULL
);
CREATE TABLE family_members (
  id TEXT PRIMARY KEY, elder_id TEXT NOT NULL REFERENCES elders(id),
  name TEXT, phone TEXT NOT NULL, auth0_sub TEXT UNIQUE, created_at TEXT NOT NULL,
  UNIQUE (elder_id, phone)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,            -- doubles as the ordering sequence
  elder_id TEXT NOT NULL REFERENCES elders(id),
  external_id TEXT UNIQUE,                         -- Twilio MessageSid, for webhook de-dup
  payload TEXT NOT NULL,                           -- JSON ChatCompletionMessageParam
  created_at TEXT NOT NULL
);
CREATE INDEX messages_elder ON messages(elder_id, id);
CREATE TABLE events (
  id TEXT PRIMARY KEY, elder_id TEXT NOT NULL REFERENCES elders(id),
  type TEXT NOT NULL, severity TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL,
  resolved_at TEXT, resolved_by TEXT REFERENCES family_members(id)
);
CREATE INDEX events_feed ON events(elder_id, status, created_at);
CREATE TABLE reminders (
  id TEXT PRIMARY KEY, elder_id TEXT NOT NULL REFERENCES elders(id),
  what TEXT NOT NULL, due_text TEXT NOT NULL, due_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', job_id TEXT, created_at TEXT NOT NULL
);
```

**History rules**
- Loaded window: the most recent 30 messages, trimmed forward so it **starts at a `user` message** —
  an assistant `tool_calls` message is never separated from its `tool` results.
- Images are sent to the model for the current turn only; they are persisted as the text part `[photo]`.

**Seeding:** `infra/seed.ts` inserts demo elder "Mak" with one `bill_explained` and one
`scam_detected` event (`detail.example = true`). It runs when `SEED_DEMO=true` **and** the `elders`
table is empty — useful on Cloud Run, where the file is ephemeral. The hardcoded seed in
`events.ts` is removed.

## 6. Agent core

```ts
// ports/llm.ts
interface Llm { complete(req: { system: string; messages: ChatCompletionMessageParam[];
                                tools: ChatCompletionTool[] }): Promise<ChatCompletionMessage> }

// agent/tool.ts
interface ToolContext { elder: Elder; clock: Clock; log: Logger }
interface Tool { schema: ChatCompletionTool; run(args: unknown, ctx: ToolContext): Promise<string> }
```

- **Tools receive `ctx` on every call.** Services are bound into tools at composition time
  (`buildTools(services)`); per-turn data arrives only through `ctx`. No module-level mutable state.
- **Tool arguments are validated with zod** inside each tool; invalid args return an explanatory
  string to the model rather than throwing.
- **Runner** (`agent/runner.ts`): `runTurn({ elder, system, history, tools, llm, maxSteps = 6 })` →
  `{ reply, newMessages }`. Behaviour matches today's loop (tool errors become tool-result text;
  step-limit returns a fallback reply). The caller persists `newMessages`.
- **Turn queue** (`agent/turn-queue.ts`): `Map<elderId, Promise>` — turns for the same elder run
  sequentially; different elders run concurrently.
- **Prompt** (`agent/prompts/careguard.ts`): the existing CareGuard prompt, moved verbatim, plus one
  appended line injecting today's date from `Clock` so reminders can resolve relative dates.

**Tool set** (legacy `remember_fact`, `answer_with_citations`, and iPhone tools removed):

| Tool | Module | Effect |
|---|---|---|
| `investigate_message` | protect | Runs investigation; on HIGH, the tool records a `scam_detected` event |
| `register_family` | family | Adds a family member for `ctx.elder` |
| `notify_family` | family | Sends an alert to every family member of `ctx.elder` |
| `create_reminder` | reminders | `{ what, dueText, dueAt? }` — persists, schedules, records `reminder_created` (low) |
| `log_document` | understand | `{ kind, summary }` — records `bill_explained` (low) — **new** |
| `web_search` | (agent) | Exa search via the `Search` port |

## 7. Modules

Each module: `routes.ts` (HTTP) and `tools.ts` (LLM) call `service.ts` (logic — no Express, no
OpenAI types) which calls `repo.ts` (SQL only). **A module calls another module only through its
service.** Services are plain factory functions taking their dependencies:
`createEventsService({ repo, bus, messenger, clock })`.

| Module | Service API | Depends on |
|---|---|---|
| `elders` | `findOrCreateByPhone(phone)`, `get(id)`, `list()` | repo |
| `family` | `register(elderId, { phone, name? })`, `list(elderId)`, `notify(elder, summary)` → `{ delivered, total }` | repo, Messenger |
| `protect` | `investigate({ text, urls, phones, senderClaim })` → `{ risk, reasons, webNote }` | Search, UrlReputation |
| `understand` | `logDocument(elder, { kind, summary })` | events |
| `reminders` | `create(elder, { what, dueText, dueAt? })`, `list(elderId?)`, `restorePending()` | repo, Scheduler, Messenger, events |
| `events` | `record(input)`, `list(query)`, `get(id)`, `approve(id, by?)`, `dismiss(id, by?)` | repo, bus, Messenger, elders |
| `conversation` | `append(elderId, messages, externalId?)`, `window(elderId)` | repo |

**Behaviour details**
- `protect.investigate` is stateless and deterministic given its ports: pattern matching, URL checks
  (structural flags, MY lookalike-brand heuristic, Safe Browsing), and web corroboration. Scoring is
  unchanged from today: HIGH if any suspicious URL or ≥2 pattern hits; MEDIUM on 1; else LOW.
- `events.approve` / `dismiss` succeed only when `status = 'new'`; otherwise they throw `Conflict`
  (HTTP 409). This makes a double-tapped Approve harmless.
- On approving a `scam_detected` or `high_risk_action` event, `events` sends the elder a fixed
  bilingual reassurance (BM first, then English). Approving a low event only changes status.
  Prompt-quality wording is event-day work.
- `events.record` / `approve` / `dismiss` publish `event.created` / `event.updated` on an in-process
  `EventEmitter` bus, which the SSE route relays.
- `reminders` with a `dueAt` are handed to the `Scheduler`; the in-process scheduler uses `setTimeout`
  and on fire sends the nudge via `Messenger` and marks the reminder `sent`. `restorePending()` runs
  at startup to reschedule future reminders. Reminders without `dueAt` are stored only.

## 8. HTTP & channels

| Route | Notes |
|---|---|
| `POST /whatsapp` | `application/x-www-form-urlencoded`; signature-checked when `TWILIO_AUTH_TOKEN` **and** `PUBLIC_URL` are set (always, in production); returns `200` + empty `<Response/>` before the turn runs |
| `GET /health` | `{ ok: true, db: true, fallbacks: string[] }` |
| `GET /api/elders`, `GET /api/elders/:id` | |
| `GET /api/events` | query validated by `ListEventsQuery`; newest first |
| `GET /api/events/:id` | |
| `POST /api/events/:id/approve`, `POST /api/events/:id/dismiss` | 409 when not `new` |
| `GET /api/reminders?elderId=` | |
| `GET /api/stream` | SSE; `StreamMessage` payloads; 25 s heartbeat comment |
| `POST /dev/simulate` | registered only when `NODE_ENV !== "production"`; `{ phone, text }` → runs the full inbound flow synchronously with a **capturing Messenger** (nothing is sent, even when Twilio is configured) and returns `{ reply, sent, events }` |

- **Errors:** a single error middleware maps `ValidationError` → 400, `NotFound` → 404,
  `Conflict` → 409, anything else → 500, always as `ApiError`.
- **Auth seam:** `require-family.ts` is mounted on `/api/*` and currently calls `next()`. Auth0
  replaces its body; routes do not change.
- **CORS:** allow `DASHBOARD_ORIGIN` only (default `http://localhost:3000`).
- **Twilio signature** (`channels/whatsapp/signature.ts`): HMAC-SHA1 over `PUBLIC_URL + path` plus
  the sorted POST params, base64, constant-time compared to `X-Twilio-Signature`. Implemented
  in-house (no `twilio` SDK dependency).
- **CLI** (`npm run cli`): readline loop calling the same function as `/dev/simulate`
  in-process (same capturing Messenger), as phone `+60000000000`, printing tool calls, captured
  outbound messages, and any events recorded.

## 9. Configuration

`infra/config.ts` parses `process.env` with zod once at startup.

| Variable | Default | If absent |
|---|---|---|
| `PORT` | `8787` | — |
| `NODE_ENV` | `development` | — |
| `DATABASE_PATH` | `./data/careguard.db` | — |
| `PUBLIC_URL` | — | signature validation cannot run → disabled (dev only) |
| `DASHBOARD_ORIGIN` | `http://localhost:3000` | — |
| `MODEL` | `gpt-4o-mini` | — |
| `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`) | — | LLM calls fail → elder receives the fallback reply; API routes unaffected |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | — | `ConsoleMessenger` logs outbound messages; signature validation disabled |
| `EXA_API_KEY` | — | `NullSearch` returns `[]` |
| `GOOGLE_SAFE_BROWSING_KEY` | — | offline URL checks only |
| `SEED_DEMO` | `false` | — |

**The app boots with no keys.** Startup logs one line listing active fallbacks. In
`NODE_ENV=production`, missing `OPENAI_API_KEY`, any `TWILIO_*`, or `PUBLIC_URL` is a startup error.

## 10. Failure handling

- **Inbound is durable before thinking:** the inbound message is persisted before the turn is
  enqueued. If the turn throws, the elder receives *"Maaf, ada masalah sikit. Cuba hantar sekali lagi ya."*
  via `Messenger`, and the error is logged with the elder id.
- **Duplicate webhooks** (same `MessageSid`) are acknowledged and ignored.
- **Timeouts:** every outbound HTTP adapter (Exa, Safe Browsing, Twilio, OpenAI) uses an
  `AbortSignal` timeout — 5 s for Exa, Safe Browsing and Twilio; 30 s for the LLM.
- **Tool errors** become tool-result text for the model and are logged.
- **Messenger send failure** returns `false`; `family.notify` reports `{ delivered, total }` so the
  tool can tell the elder honestly, and the reply-to-elder failure is logged.
- **Shutdown:** `SIGTERM` stops accepting requests, waits for in-flight turns (max 10 s), closes the DB.

## 11. Testing

Vitest across workspaces; supertest for HTTP. No test calls a live external service.

| Layer | Covers |
|---|---|
| Unit — `protect` | Malay + English scam samples; lookalike domains for MY banks; shortener / raw-IP / punycode flags; scoring thresholds; runs with `NullSearch` and a fake `UrlReputation` |
| Unit — signature | Known-good Twilio signature vector; tampered param rejected |
| Unit — history window | Never starts mid tool-call; images persisted as `[photo]` |
| Service (in-memory SQLite, migrations applied) | elders find-or-create idempotent; family register + notify with `FakeMessenger`; events approve → 409 on second call, reassurance sent only for high events; reminders schedule + fire with fake scheduler/clock |
| Agent runner (`FakeLlm` with scripted responses) | tool dispatch, step limit, tool error surfaced; **P2 regression:** two elders' turns interleaved → each event lands on the right elder |
| HTTP (supertest) | bad signature → 403; webhook returns 200 before the turn completes; duplicate `MessageSid` ignored; event filters; error shape |
| Dashboard | `typecheck` + `next build` only |

**CI** (`.github/workflows/ci.yml`): on push and PR — `npm ci`, `npm run typecheck`, `npm test`.

## 12. Scope

### Foundation — committed on `feature/architecture`
1. npm workspaces, `tsconfig.base.json`; delete `src/agent/iphone/*`, `src/surfaces/{whatsapp,scamguard,slack,server,careguard,cli}.ts`, `src/web/`, `remember_fact`, `answer_with_citations`, `@slack/bolt` and the stale scripts
2. `infra/` config, db, migrations, seed; all ports and adapters listed in §2
3. the seven modules
4. agent runner, tool types, registry, turn queue, prompt module
5. WhatsApp channel (signature, ack-then-process, de-dup), `/dev/simulate`, CLI
6. Events API, SSE, `requireFamily` seam, CORS, error middleware
7. `packages/shared`
8. dashboard **shell**: Next.js App Router app with `lib/api.ts` typed client and one server-rendered page listing events as plain text — no styling, CopilotKit, or auth
9. tests (§11), CI, multi-stage `Dockerfile` for the API (runtime via `tsx`), README §10 and `CLAUDE.md` run/layout instructions updated; `.env.example` updated to §9
10. this spec

### Event features — `feature/careguard-core`, uncommitted
- Dashboard: events feed, severity cards, approve/dismiss, live updates via `/api/stream`, elder switcher; visual design recorded in project `Design.md`
- CopilotKit runtime at `apps/dashboard/app/api/copilotkit/route.ts`, copilot Q&A, generative-UI event cards
- Auth0: dashboard login; `requireFamily` implementation linking `auth0_sub` → family member → elders
- Trigger.dev `Scheduler` adapter replacing the in-process one
- Prompt tuning in BM / Manglish on real bills and scam screenshots; reassurance wording
- Cloud Run deploy for API and dashboard (requires installing `gcloud`)

### Out of scope
Voice, appointment system, configurable risk engine, multi-tenant organisations, non-WhatsApp elder
channels, message media storage.

## 13. Changes made while planning (2026-09-13)

Verified against the installed toolchain before the implementation plan was written. Where this
section and §1–§12 disagree, this section wins.

1. **`better-sqlite3` is pinned to `^12`.** 13.0.3's darwin-arm64 prebuild segfaults on Node 22.13.1,
   even outside Vitest. 12.11.1 passes on macOS arm64, inside Vitest workers, and in `node:22-slim`.
2. **Inbound messages are persisted at the start of the queued turn, not before enqueueing** (changes
   §3 step 1 and §10). Persisting at webhook time would give a second message a row id lower than the
   first turn's replies and scramble history order. De-duplication on `MessageSid` still holds because
   it runs inside the per-elder queue. Trade-off: a crash between the `200` ack and the start of the
   turn loses that one message.
3. **The Messenger is passed per turn in `ToolContext`** (changes §6), and `family.notify(elder,
   summary, messenger)` receives it per call (changes §7). This is what lets `/dev/simulate` and the
   CLI capture family alerts instead of sending them. `events` and `reminders` keep the process-wide
   Messenger, because approvals and nudges happen outside a turn.
4. **The lookalike-brand heuristic matches whole words** (`\bpos\b`) with aliases such as
   "public bank", and bare domains get `http://` before parsing. The old substring match treated
   "deposit" as a Pos Malaysia mention.
5. **The appended prompt line also instructs the model to call `log_document`** after explaining a
   document (§6); without it the tool is never used.
6. **Tool schemas are generated with `z.toJSONSchema`** (its `$schema` key stripped).
   `create_reminder.dueAt` is a plain string validated in the reminders service, because
   `z.iso.datetime` expands to a very long regex in JSON Schema.
7. **Test doubles:** `CapturingMessenger` is both the simulate/CLI messenger and the test fake. The P2
   regression test exists at the runner level and at the pipeline level.
8. **Phone helpers live in `src/phone.ts`.** Elders are keyed by Twilio's `whatsapp:+60…` form; family
   numbers are stored as `+60…`, normalised from local formats such as `012-345 6789`.
9. **Composition lives in `src/services.ts` and `src/runtime.ts`**, shared by `main.ts`, the CLI and tests.

# CareGuard 💙 — build brief & context

> **For the coding agent:** this file is the full context for building CareGuard at the
> "Agents, Everywhere" hackathon. Read it top to bottom before writing code. `CLAUDE.md`
> is the short version; this is the source of truth.

---

## 1. One-line pitch

**CareGuard is a WhatsApp agent that protects elderly Malaysians from scams and helps them
understand confusing bills/letters — and it loops in their family when something matters.**
The thesis: **the AI learns to talk to the elderly, instead of forcing the elderly to learn the AI.**

---

## 2. The event & the rules (context)

- **Hackathon:** AI Tinkerers — *Agents, Everywhere* (global), Kuala Lumpur.
- **Build window:** ~11:15–15:30 (Sun 13 Sep). **Submit by 15:30.** ~4 hours of real build time.
- **Theme:** build an agent for a place people already work/talk/live, and make it *meaningfully
  more useful because of that environment*. (WhatsApp, where elders already are, is that environment.)
- **Judging criteria (1–5 each):**
  1. Core requirements & functionality — a working agent in a real place.
  2. Innovation & theme alignment — the environment must materially improve it vs a generic chatbot.
  3. Technical execution & integration depth.
  4. Usefulness & agentic experience — clear value for the intended user.
- **Submission:** project title · written description · **public GitHub repo** · **2-min demo video** ·
  social post tagging sponsors.
- **⚠️ Eligibility (important):** net-new builds only. Templates/libraries/starter code are allowed,
  but **core functionality must be built during the event**, and you must be able to explain what
  was built during hackathon hours. **Treat THIS repo as the template/scaffold** — build the
  submission's core (dashboard, refined investigation, Auth0, Trigger.dev) live tomorrow.

---

## 3. Why this wins (targets & positioning)

- **Timely problem:** Malaysians lost ~**RM2.97 billion** to scams in 2025 (highest in 3 years);
  elderly are a documented, rising target. Massive local "so what" for a KL panel.
- **Rides two 2026 trends:** **generative UI** (CopilotKit's whole thesis — the family dashboard)
  and **human-in-the-loop trust** (the escalation model).
- **Beats existing tools:** Malaysia's scam tools (Semak Mule, etc.) are *passive lookup* — the
  victim must already be suspicious and go check. CareGuard is *proactive, conversational,
  in-WhatsApp, and family-connected.*
- **Prize targets:** overall (OpenAI + Exa credits) **and** the **CopilotKit category prize**
  (the dashboard is the generative-UI surface).

**Definition of "not typical":** if a judge would call it "a scam detector," we failed. If they'd
call it "the thing that keeps my mum safe and keeps me in the loop," we won. Center the
**relationship**, not the detection.

---

## 4. Killer features (in priority order)

1. **The elderly communication layer** — every reply is short, warm, jargon-free, and in the
   user's language (English / Bahasa Melayu / Manglish / Chinese / Tamil). *This is the core
   innovation.* It lives mostly in the system prompt (`apps/api/src/agent/prompts/careguard.ts`).
2. **Protect** — forward a suspicious message/screenshot → the agent investigates (scam-language
   patterns + URL reputation + web search) → warns in plain language *with reasons*.
3. **Notify Family (the differentiator)** — on a high-risk scam, the agent alerts a trusted family
   member. CareGuard is a *guardian*, not a checker. **This is the emotional climax of the demo.**
4. **Understand** — photo of a bill/letter → explained simply → offer to set a reminder.
5. **Act + human-in-the-loop escalation** — low-risk (reminder) is automatic; medium-risk asks the
   elder; **high-risk requires family approval on the dashboard** before any irreversible step.
6. **The family dashboard (CopilotKit)** — shows only events that need attention (never
   surveillance), lets the family approve/dismiss, and answers "what happened with mum this week?"
   via an in-app copilot with generative UI.

---

## 5. Architecture

Two surfaces, one backend, one shared event store.

```
  👵 Elder · WhatsApp (Twilio)            👨‍👩‍👧 Family · CopilotKit dashboard (Next.js)
        │  forward photo/msg                     │  read events · approve · ask copilot
        ▼                                        ▼
  ┌─────────────────────────── Backend (one service, Google Cloud Run) ───────────────────────────┐
  │  Agent core (tool loop + communication-layer prompt)   ·   Events API (REST)   ·   Data store  │
  └───────────────────────────────────────────────────────────────────────────────────────────────┘
        │            │             │              │            │
        ▼            ▼             ▼              ▼            ▼
     OpenAI        Exa       Safe Browsing    Trigger.dev    Auth0
   (vision +   (scam/web    (URL reputation) (reminder      (family identity
    reasoning)  lookup)                        scheduling)   + approvals)
```

### Two core flows
- **Understand:** photo → vision reads it → communication layer explains → `create_reminder`
  (Trigger.dev) → write a `bill_explained` (low) event → appears on family timeline.
- **Protect + escalate:** forwarded scam → vision extracts text/link/number → `investigate_message`
  (patterns + Safe Browsing + Exa) → warn simply → write a `scam_detected` (**high**) event →
  `notify_family` (WhatsApp) → family approves on the dashboard → agent reassures the elder.

### Data model (SQLite — `apps/api/src/infra/migrations/001_init.sql`)
- `events`: id, elderId, type (`bill_explained` | `scam_detected` | `high_risk_action`
  | `reminder_created`), severity (`low` | `med` | `high`), summary, detail, status
  (`new` | `approved` | `dismissed` | `resolved`), createdAt, resolvedAt, resolvedBy. **This is the spine both surfaces share.**
- `elders` (keyed by WhatsApp number), `family_members` (`auth0_sub` reserved for Auth0), `reminders`,
  and `messages` (conversation history).

---

## 6. What's already here (TEMPLATE) vs what to BUILD LIVE

### Already built (foundation — design in `docs/superpowers/specs/2026-09-13-careguard-architecture-design.md`)
- `apps/api` — one Express process: WhatsApp webhook (`POST /whatsapp`, Twilio-signature checked, replies
  asynchronously), Events API + live stream (`/api/*`), and a dev simulator (`POST /dev/simulate`).
- `apps/api/src/agent/prompts/careguard.ts` — **the communication-layer system prompt.**
- `apps/api/src/modules/protect/` — scam investigation (patterns + URL reputation + web search → verdict).
- `apps/api/src/modules/family/` — `register_family` / `notify_family`.
- `apps/api/src/modules/reminders/` — `create_reminder` with an in-process scheduler.
- `apps/api/src/modules/understand/` — `log_document` (writes `bill_explained` events).
- `apps/api/src/modules/events/` — the shared event store and the dashboard contract:
  `GET /api/events?elderId=&status=&severity=&since=` · `GET /api/events/:id` · `POST /api/events/:id/approve` ·
  `POST /api/events/:id/dismiss` · `GET /api/reminders?elderId=` · `GET /api/elders` · `GET /api/stream` (SSE).
- `packages/shared` — zod contracts used by the API and the dashboard. `apps/dashboard` — Next.js shell.
- `npm run cli` — terminal tester running the real CareGuard pipeline (no WhatsApp needed).

### Build live tomorrow (the "core functionality")
- [ ] **CopilotKit family dashboard** (`apps/dashboard`, Next.js): events feed, approve/dismiss buttons,
      and a CopilotKit copilot that answers "what happened this week?" from the events. Calls the
      Events API above. **This is the CopilotKit category-prize surface — prioritise it.**
- [ ] **Auth0** login on the dashboard + gate `POST /approve` to the linked family member.
- [ ] **Trigger.dev** — make `create_reminder` schedule a real WhatsApp nudge at the due time
      (currently an in-process scheduler behind the `Scheduler` port).
- [x] **Wire approval → action** (foundation): approving a scam event sends the elder a reassurance —
      tune its wording in `apps/api/src/modules/events/service.ts`.
- [ ] **Refine the communication layer** — tune the prompt in `apps/api/src/agent/prompts/careguard.ts` until BM/Manglish
      explanations are short, correct, and warm on real bills and real scam screenshots.
- [ ] **Deploy** backend + dashboard to Cloud Run.

---

## 7. Build plan (parallel tracks — see the target order)

**Lock the Events API shape first (H0). Then build in parallel.**

- **Track A — WhatsApp + agent** (`apps/api/src/agent`, `modules/protect`, `modules/reminders`): get
  forward→verdict→event working end to end; refine the communication layer.
- **Track B — CopilotKit dashboard** (`apps/dashboard`): Auth0 + events feed + approve + live stream +
  copilot Q&A. *Highest-value new build.*
- **Track C — backend + deploy** (`apps/api/src/http`, `modules/events`, Trigger.dev): keep the Events API
  solid, wire Trigger.dev, deploy both to Cloud Run.

**Protect this three-part loop above all else:** scam on WhatsApp → HIGH event on the dashboard →
family approval flows back to the elder. That loop *is* the demo.

**Cut-list if behind:** Cloud Run (demo via ngrok) → live Safe Browsing (offline checks still work)
→ Auth0 (open dashboard) → copilot Q&A (static feed). Never cut the loop or the rehearsal.

---

## 8. Sponsor / tool map (targets)

| Sponsor | Role | Target |
|---|---|---|
| OpenAI | Vision + communication layer + dashboard copilot | Core / overall prize |
| CopilotKit | Family dashboard: in-app copilot + generative UI | **Category prize** |
| Exa | Scam investigation + explaining unfamiliar orgs | Core |
| Auth0 | Family identity + approval authorization | Core |
| Trigger.dev | Scheduled reminder nudges | Core |
| Google Cloud Run | Deploy backend + dashboard | Core |
| Ambiguous AI | "Family teammate" framing (only if you build on it) | Optional |
| OpenRouter, Mozilla | Not needed — OpenAI covers models | Skip |

---

## 9. The demo (target — two screens, side by side)

1. **Understand:** elder sends a TNB bill photo → simple explanation + reminder → calm card on the
   family timeline.
2. **Protect + escalate:** elder forwards a bank scam → simple-Malay warning → **red HIGH card**
   on the dashboard → family taps **Approve** (Auth0) → elder gets a reassuring message.
3. **Copilot:** family asks the dashboard "what happened with mum this week?" → generative-UI summary.
4. **Close:** "One agent — speaks their language on WhatsApp, gives the family peace of mind on the
   dashboard — built on OpenAI, CopilotKit, Exa, Auth0, Trigger.dev, on Cloud Run."

**Honesty line to say on stage:** CareGuard *flags and advises* — it never guarantees, never tells
anyone to click a link or share an OTP; when unsure it says "call your bank on the number on your card."

---

## 10. Run & setup

```bash
npm install
cp .env.example .env      # add keys as you get them — the API boots without any

npm run dev:api           # API on http://localhost:8787 — WhatsApp webhook, Events API, /dev/simulate
npm run dev:dashboard     # dashboard shell on http://localhost:3000
npm run cli               # chat with the real CareGuard pipeline in the terminal (no WhatsApp needed)
npm test                  # vitest (api + shared)
npm run typecheck         # every workspace
```

Missing keys switch on fallbacks, listed at startup and on `GET /health`: without OpenAI the elder gets
the fallback reply; without Twilio outbound messages are logged; without Exa / Safe Browsing only offline
checks run.

Try a turn without WhatsApp:
```bash
curl -s -X POST localhost:8787/dev/simulate -H 'content-type: application/json' \
  -d '{"phone":"+60123456789","text":"Akaun Maybank anda disekat. Sahkan segera di maybank-verify.xyz"}'
```

### Environment variables (`.env` at the repo root — see `.env.example`)
- `OPENAI_API_KEY` (+ optional `MODEL`, default `gpt-4o-mini`) — unlock credits by checking in at the event.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` — WhatsApp sandbox (join from
  two phones: the "elder" and the "family").
- `PUBLIC_URL` — the public origin Twilio calls (ngrok or Cloud Run); enables signature checks.
- `EXA_API_KEY`, `GOOGLE_SAFE_BROWSING_KEY` — optional; make the investigation live.
- `SEED_DEMO=true` — load demo elder "Mak" and two example events into an empty database.
- (build live) Auth0 domain + client ID; Trigger.dev key.

### WhatsApp setup
Twilio console → Messaging → Try it out → **WhatsApp sandbox**. Join with the code from both phones.
Run `npm run dev:api`, expose it (`npx ngrok http 8787`), set `PUBLIC_URL` to the ngrok origin, and set
the sandbox "when a message comes in" webhook to `https://<host>/whatsapp`.

### Deploy the API (Cloud Run)
```bash
gcloud run deploy careguard-api --source . --no-cpu-throttling --max-instances=1 --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,PUBLIC_URL=https://<service-url>,SEED_DEMO=true,OPENAI_API_KEY=...,TWILIO_ACCOUNT_SID=...,TWILIO_AUTH_TOKEN=...,TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```
`PUBLIC_URL` is required in production. Cloud Run service URLs are predictable
(`https://<service>-<project-number>.<region>.run.app`), so it can be set on the first deploy.
`--no-cpu-throttling` keeps turns running after the webhook responds; `--max-instances=1` keeps SQLite
single-writer. The database is lost when the container restarts — `SEED_DEMO=true` restores the demo data.

---

## 11. Non-negotiables (constraints for the agent)

- **Keep scope tight.** One pipeline, two cases (Understand + Protect), one escalation. Do NOT build
  the full "elderly-care platform" — no configurable risk engine, no voice, no appointment system.
- **The communication layer is the product** — invest in the prompt, not feature count.
- **Never** have the agent tell a user to click a link, share an OTP/TAC/password, or take an
  irreversible financial action without family approval.
- **Build the core live** (eligibility). This repo is scaffolding/reference.

# CLAUDE.md — CareGuard

**Read `README.md` first — it is the full build brief (goals, architecture, tasks, demo, constraints).**
This file is the quick directive.

## What we're building
A WhatsApp agent that protects elderly Malaysians from scams and explains confusing bills/letters in
simple language, and alerts a family member when it matters. Thesis: **the AI adapts to the elder,
not the reverse.** Two surfaces — **WhatsApp** (elder) + a **CopilotKit dashboard** (family) — over
one backend and a shared `events` store.

## Priorities (in order)
1. The **elderly communication layer** (short, warm, jargon-free, BM/English/Manglish) — mostly the
   system prompt in `src/surfaces/careguard.ts`. This is the core innovation.
2. **Protect** — `investigate_message` (patterns + URL reputation + Exa) → plain-language warning.
3. **Notify Family** — the differentiator and the demo's emotional climax.
4. **Understand** — explain a bill photo → offer a reminder.
5. **CopilotKit family dashboard** — the category-prize surface; reads the Events API, approves events,
   answers "what happened this week?".

## Build live (this repo is a TEMPLATE — eligibility requires core built during the event)
- The CopilotKit dashboard (`/dashboard`, Next.js) against the Events API in `src/surfaces/server.ts`.
- Auth0 login + gate `/api/events/:id/approve`.
- Trigger.dev: make `create_reminder` schedule a real WhatsApp nudge.
- Wire approval → agent reassures the elder (TODO in `server.ts`).
- Deploy backend + dashboard to Cloud Run.

## The loop to protect above all
scam on WhatsApp → HIGH event on the dashboard → family approval flows back to the elder. **That is
the demo.** If time is short, cut everything else before this loop or the rehearsal.

## Hard constraints
- **Keep scope tight** — one pipeline, two cases, one escalation. No platform sprawl (no config risk
  engine, no voice, no appointments).
- Never tell a user to click a link, share an OTP/TAC/password, or make an irreversible financial move
  without family approval. CareGuard **flags and advises**, never guarantees.
- Verify with `npm run typecheck` and `npm run cli` as you go.

## Run
`npm run cli` (test agent, no WhatsApp) · `npm run careguard` (WhatsApp surface) ·
`npm run server` (Events API + widget). Keys in `.env` — see README §10.

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
   system prompt in `apps/api/src/agent/prompts/careguard.ts`. This is the core innovation.
2. **Protect** — `investigate_message` (patterns + URL reputation + Exa) → plain-language warning.
3. **Notify Family** — the differentiator and the demo's emotional climax.
4. **Understand** — explain a bill photo → offer a reminder.
5. **CopilotKit family dashboard** — the category-prize surface; reads the Events API, approves events,
   answers "what happened this week?".

## Build live (this repo is a TEMPLATE — eligibility requires core built during the event)
- The CopilotKit dashboard in `apps/dashboard` (Next.js) against the Events API
  (`apps/api/src/modules/events/routes.ts`; live updates on `GET /api/stream`).
- Auth0 login + implement `apps/api/src/http/require-family.ts` (gates `/api/events/:id/approve`).
- Trigger.dev: a `Scheduler` adapter so `create_reminder` nudges survive restarts.
- Tune the approval reassurance (`apps/api/src/modules/events/service.ts`) and the prompt.
- Deploy backend + dashboard to Cloud Run.

## The loop to protect above all
scam on WhatsApp → HIGH event on the dashboard → family approval flows back to the elder. **That is
the demo.** If time is short, cut everything else before this loop or the rehearsal.

## Hard constraints
- **Keep scope tight** — one pipeline, two cases, one escalation. No platform sprawl (no config risk
  engine, no voice, no appointments).
- Never tell a user to click a link, share an OTP/TAC/password, or make an irreversible financial move
  without family approval. CareGuard **flags and advises**, never guarantees.
- Verify with `npm test`, `npm run typecheck` and `npm run cli` as you go.

## Layout
- `apps/api` — the one backend process: WhatsApp channel, agent, modules, Events API. Modules are
  `routes.ts`/`tools.ts` → `service.ts` → `repo.ts`; a module talks to another only through its service.
  External services sit behind `src/ports/`; tools get per-turn data only via `ToolContext`.
- `apps/dashboard` — Next.js family dashboard (shell so far).
- `packages/shared` — zod contracts shared by both apps.
- Design: `docs/superpowers/specs/2026-09-13-careguard-architecture-design.md` (§13 lists changes made while planning).

## Run
`npm run dev:api` (API, :8787) · `npm run dev:dashboard` (:3000) · `npm run cli` (test the agent, no WhatsApp) ·
`npm test` · `npm run typecheck`. Keys in `.env` — see `.env.example`; the API boots without any.

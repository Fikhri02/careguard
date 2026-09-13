# CareGuard 💙

**A chat agent that protects elderly Malaysians from scams, explains confusing bills in their own language, and brings their family in the moment it matters.**

The AI learns to talk to the elderly, instead of forcing the elderly to learn the AI.

Built at AI Tinkerers **Agents, Everywhere**, Kuala Lumpur, 13 Sep 2026.

**Try it:** message [@careguard_my_bot](https://t.me/careguard_my_bot) on Telegram and forward it any suspicious SMS. The bot runs from the team's laptop, so it's only online while we are.

---

## The problem

Scams in Malaysia are rising, and the elderly are a documented target. Existing tools like Semak Mule are passive lookups: they only help someone who is already suspicious and knows where to check. Elderly victims often don't suspect anything, and after a scam many are too embarrassed to tell their family.

## What CareGuard does

CareGuard lives in the chat app the elder already uses. The family gets a dashboard.

| Elder (in chat) | Family (dashboard) |
|---|---|
| Forwards a suspicious message → a plain-language warning, why it's suspicious, what not to do, and how to check safely | A **High risk** card appears live, with the reasons and the link |
| Sends a photo of a bill → what it is, the amount, the due date, and "Nak saya ingatkan awak nanti?" | "Document explained" and "Reminder set" show up in the activity timeline |
| Has already clicked or shared a TAC → an urgent, calm plan: call the bank's 24-hour hotline, then NSRC at 997 | An urgent "please call them now" alert |
| Asks "Siapa keluarga saya?" → CareGuard knows who is saved | **Ask CareGuard** copilot: "What happened with Mak this week?", "Approve the Maybank alert", "Tell Mak I'll call tonight" |

### The loop

1. Mak forwards a fake Maybank "account blocked" SMS.
2. CareGuard investigates it: scam-language patterns, a link that imitates a bank domain, and a web search.
3. On a high-risk verdict, **her son is alerted on Telegram straight away**, and a red card appears on his dashboard.
4. Mak is warned in Malay and told her family knows.
5. Her son taps **Approve**, and Mak receives a reassuring message.

## What makes it different

- **The communication layer is the product.** Every reply follows explicit rules: simple words, terms like OTP and TAC explained, one step at a time with the exact button name, no "atuk/nenek" guesses, never "senang je", the elder's own language (Bahasa Melayu, English, Manglish and more), and a recovery path when they say "tak faham". See [`communication-rules.ts`](apps/api/src/agent/prompts/communication-rules.ts).
- **Consent is given once, not in the moment.** When the elder's family is saved, a high-risk scam alerts them without asking. An embarrassed elder is the one most likely to say "don't tell my son". The elder is always told.
- **The family decides.** CareGuard flags and advises; it never guarantees, never tells anyone to click a link or share a code, and approvals stay with the family.
- **Rules the model kept breaking are enforced in code:** a reminder is only created after the elder says yes, the reply language is pinned to the elder's own messages, and one scam sends one family alert.
- **Reply quality is measured, not claimed** (below).

## Reply quality, measured

`npm run eval` runs 10 realistic elder conversations through the real pipeline and model. Nothing is sent to a phone. Each reply is scored with rule checks (language, never asking for a credential, one step at a time, the warning format, the right tools and events) and a second model acting as judge. The run fails if any safety check fails.

| Run on 13 Sep | Checks passed | Safety failures |
|---|---|---|
| First version of the reply rules | 92 / 105 (88%) | 2 |
| Rules tightened, two checker bugs fixed | 95 / 105 (90%) | 0 |
| Code guards for reminders and reply language | 102 / 105 (97%) | 0 |
| Automatic family alert, plus a "family already saved" scenario | 113 / 119 (95%) | 0 |

Scores move a few points between runs because the model varies.

## Architecture

```
  👵 Elder · Telegram (WhatsApp adapter built)       👨‍👩‍👧 Family · Next.js + CopilotKit dashboard
        │  text · photos                                   │  live feed · Approve · People · copilot actions
        ▼                                                  ▼
  ┌──────────────────────────── API (one Node process, SQLite) ────────────────────────────┐
  │  Agent (tool loop + communication rules + code guards)  ·  Events API + live stream    │
  │  Tools: investigate_message · notify_family · register_family · log_document ·         │
  │         create_reminder · web_search                                                   │
  └────────────────────────────────────────────────────────────────────────────────────────┘
        │                    │                    │
   OpenAI gpt-4o-mini       Exa             URL reputation
   (via OpenRouter;     (web search)       (offline checks; Safe
    vision + reasoning)                     Browsing when keyed)
```

- **Channels sit behind one interface.** Telegram (long polling, so no public URL is needed) and WhatsApp (Twilio, signature-checked webhook) feed the same pipeline.
- **One shared event store** connects both surfaces: `scam_detected` (high), `bill_explained` and `reminder_created` (low). The dashboard reads it through a REST API and a live server-sent event stream.
- **Modules** go `routes/tools → service → repo`, and external services sit behind ports, so tests run on fakes and the eval runs on the real model.

## Run it locally

Needs Node 22.12+.

```bash
npm install
cp .env.example .env
npm run dev:api          # API on http://localhost:8787 (also starts the Telegram bot)
npm run dev:dashboard    # dashboard on http://localhost:3000
```

In `.env`:

| Setting | Value |
|---|---|
| `OPENAI_API_KEY` | An OpenAI or OpenRouter key |
| `OPENAI_BASE_URL`, `MODEL` | For OpenRouter: `https://openrouter.ai/api/v1` and `openai/gpt-4o-mini` |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `EXA_API_KEY`, `GOOGLE_SAFE_BROWSING_KEY` | Optional — live web and link checks |

The API boots without any keys and lists the fallbacks it's using at `GET /health`.

**Set up the two roles:** both people open the bot, tap Start and send a message. On the dashboard, under **People**, mark one as **Family of** the other.

Other commands:

```bash
npm test             # 201 tests (vitest)
npm run typecheck    # every workspace
npm run eval         # reply-quality eval against the real model (costs a little credit)
npm run cli          # chat with the real pipeline in the terminal
```

Try a turn without any chat app:

```bash
curl -s -X POST localhost:8787/dev/simulate -H 'content-type: application/json' \
  -d '{"phone":"+60123456789","text":"Akaun Maybank anda telah disekat. Sila sahkan segera di maybank-verify.xyz"}'
```

## Layout

```
apps/api         the one backend: channels (telegram, whatsapp), agent, modules, HTTP API, evals
apps/dashboard   Next.js family dashboard with CopilotKit
packages/shared  zod contracts shared by both apps
docs/superpowers the architecture spec and implementation plan
```

## Why Telegram and not WhatsApp

Elderly Malaysians live on WhatsApp, and the WhatsApp channel is built: a Twilio webhook with signature checks, photo download and replies. But a Twilio trial account can only send pre-approved message templates, so CareGuard can't reply on WhatsApp without a paid upgrade. Because channels share one interface, the agent, tools and dashboard are identical on both; we demo on Telegram.

## Built during the event

Commit `372618a` is the pre-event starter scaffold. Everything after it was built on 13 Sep 2026 — see the commit history:

- The modular API architecture, the Telegram channel and the WhatsApp adapter
- The live family dashboard, with alert cards, Approve / Dismiss, the timeline and live updates
- The CopilotKit copilot, including actions that approve alerts and message the elder
- The People section, which labels elders and family
- The elderly communication rules, the code guards and the reply-quality eval
- The automatic family alert, with one alert per scam and an urgent path when details were already shared

## What's next

- **Voice notes in and out**, in dialects, for elders who don't type
- **Live scam-call guarding**: CareGuard listens in on a suspicious call and warns in real time
- **A golden-hour response** after a scam: a pre-filled NSRC 997 report and bank hotline steps
- **Family onboarding** from the dashboard with invite links and Auth0 login
- **Durable reminders** (Trigger.dev) and a Cloud Run deploy (a Dockerfile is included)
- **A scam radar across families**: a link caught once warns everyone

## Safety

CareGuard flags and advises; it never guarantees. It never tells anyone to click a link, share an OTP, TAC or password, or move money. When unsure, it says: call your bank on the number on the back of your card.

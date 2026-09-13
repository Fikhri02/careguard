# CareGuard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the CareGuard starter into a modular monolith — one API process (WhatsApp channel, agent, modules, Events API + SSE) on SQLite, shared zod contracts, and a Next.js dashboard shell — with tests, CI and a Docker image.

**Architecture:** npm workspaces: `packages/shared` (zod contracts), `apps/api` (Express 5, modules shaped routes/tools → service → repo, external services behind ports), `apps/dashboard` (Next.js shell). Agent tools receive a per-turn `ToolContext`; turns run on a per-elder queue after the webhook has already acknowledged Twilio.

**Tech Stack:** Node 22 · TypeScript ~5.9 · Express 5 · zod 4 · better-sqlite3 12 · openai 4.104 · Vitest 5 + supertest 7 · Next.js 16 / React 19 · Docker `node:22-slim`

**Spec:** `docs/superpowers/specs/2026-09-13-careguard-architecture-design.md` — read §13 first; it overrides earlier sections where they differ.

## Global Constraints

- Work on branch `feature/architecture`. Commit at the end of every task. End every commit message with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Stage explicit paths (never `git add .`). Never push, never `--no-verify`.
- Node `>=22.12` (Vitest 5 floor). TypeScript `~5.9.3` — **not** 7.x.
- Pinned majors: `express@^5.2.1`, `zod@^4.6.3`, `better-sqlite3@^12.11.1` (**not 13** — segfaults on darwin-arm64/Node 22.13), `@types/better-sqlite3@^9.6.0`, `openai@^4.104.0`, `vitest@^5.0.0`, `supertest@^7.2.2`, `next@^16.3.5`, `react@^19.3.0`, `tsx@^4.23.13`, `dotenv@^16.6.1`.
- ESM everywhere (`"type": "module"`). Relative imports in `apps/api` and `packages/shared` use the `.js` extension (matches the existing code).
- Express handlers use block bodies (`(req, res) => { res.json(x); }`).
- No test calls a live external service. Tests use `CapturingMessenger`, `FakeLlm`, `fakeSearch`, `fakeUrlReputation`, `fixedClock`, in-memory SQLite.
- User-facing copy that must stay exactly as written: fallback reply `Maaf, ada masalah sikit. Cuba hantar sekali lagi ya.`
- The app must boot with **no** API keys outside production.
- Run commands from the repo root `/Users/fikhri/Projects/careguard` unless a step says otherwise.

## File Map

```
package.json · tsconfig.base.json · vitest.config.ts · .gitignore · .dockerignore · Dockerfile · .env.example
.github/workflows/ci.yml
packages/shared/src/        elder.ts family.ts event.ts reminder.ts api.ts index.ts contracts.test.ts
apps/api/src/
  errors.ts phone.ts services.ts runtime.ts main.ts cli.ts load-env.ts
  infra/        config.ts db.ts ids.ts seed.ts migrations/001_init.sql
  ports/        clock.ts logger.ts messenger.ts search.ts url-reputation.ts scheduler.ts llm.ts
  adapters/     system-clock.ts console-logger.ts console-messenger.ts capturing-messenger.ts
                twilio-messenger.ts twilio-media.ts exa-search.ts null-search.ts safe-browsing.ts
                offline-url-reputation.ts openai-llm.ts in-process-scheduler.ts
  agent/        tool.ts registry.ts runner.ts turn-queue.ts pipeline.ts web-search-tool.ts prompts/careguard.ts
  modules/elders/        repo.ts service.ts routes.ts
  modules/conversation/  repo.ts service.ts
  modules/events/        repo.ts bus.ts service.ts routes.ts
  modules/family/        repo.ts service.ts tools.ts
  modules/reminders/     repo.ts service.ts tools.ts routes.ts
  modules/understand/    service.ts tools.ts
  modules/protect/       patterns.ts urlcheck.ts service.ts verdict.ts tools.ts
  channels/whatsapp/     signature.ts inbound.ts webhook.ts
  channels/simulate.ts
  http/         app.ts errors.ts cors.ts require-family.ts sse.ts
  test/         db.ts fakes.ts harness.ts
apps/dashboard/ package.json next.config.ts tsconfig.json app/layout.tsx app/page.tsx lib/api.ts
DELETED:        src/ (all legacy starter code) · tsconfig.json (root)
```

---

### Task 1: Workspace skeleton and shared contracts

**Files:**
- Modify: `package.json` (replace entirely), `.gitignore`
- Create: `tsconfig.base.json`, `vitest.config.ts`, `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/{elder,family,event,reminder,api,index}.ts`
- Test: `packages/shared/src/contracts.test.ts`

**Interfaces:**
- Produces (from `@careguard/shared`): zod schemas **and** same-named types `Elder`, `FamilyMember`, `EventType`, `Severity`, `EventStatus`, `CareEvent`, `DocumentKind`, `ReminderStatus`, `Reminder`, `ListEventsQuery`, `ListRemindersQuery`, `ApiError`, `StreamMessage`, `SimulateRequest`, `OutboundMessage`; plain types `EventListResponse`, `ElderListResponse`, `ReminderListResponse`, `SimulateResponse`.

- [ ] **Step 1: Replace the root `package.json`**

The legacy `src/` stays on disk until Task 13 but is no longer referenced by any script.

```json
{
  "name": "careguard",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev:api": "npm run dev -w @careguard/api",
    "dev:dashboard": "npm run dev -w @careguard/dashboard",
    "cli": "npm run cli -w @careguard/api",
    "test": "vitest run",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build:dashboard": "npm run build -w @careguard/dashboard"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "~5.9.3",
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`, `vitest.config.ts`, and extend `.gitignore`**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: ["packages/shared"] },
});
```

`.gitignore` (replace):
```
node_modules
.env
.env.local
dist
*.log
.DS_Store
data/
*.db
*.db-shm
*.db-wal
.next/
next-env.d.ts
*.tsbuildinfo
```

- [ ] **Step 3: Create the shared package manifest and configs**

`packages/shared/package.json`:
```json
{
  "name": "@careguard/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^4.6.3" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "shared", include: ["src/**/*.test.ts"], environment: "node" },
});
```

Run: `npm install`
Expected: completes; `node_modules/@careguard/shared` is a symlink to `packages/shared`.

- [ ] **Step 4: Write the failing contract test**

`packages/shared/src/contracts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CareEvent, ListEventsQuery, SimulateRequest, StreamMessage } from "./index.js";

const event = {
  id: "evt_1",
  elderId: "eld_1",
  type: "scam_detected",
  severity: "high",
  summary: "Likely scam",
  detail: { reasons: ["asks for TAC"] },
  status: "new",
  createdAt: "2026-09-13T03:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

describe("shared contracts", () => {
  it("accepts a valid CareEvent", () => {
    expect(CareEvent.parse(event)).toEqual(event);
  });

  it("rejects an unknown severity", () => {
    expect(CareEvent.safeParse({ ...event, severity: "critical" }).success).toBe(false);
  });

  it("validates event list filters", () => {
    expect(ListEventsQuery.parse({ status: "new", severity: "high" })).toEqual({ status: "new", severity: "high" });
    expect(ListEventsQuery.safeParse({ status: "open" }).success).toBe(false);
    expect(ListEventsQuery.safeParse({ since: "yesterday" }).success).toBe(false);
    expect(ListEventsQuery.safeParse({ since: "2026-09-13T03:00:00.000Z" }).success).toBe(true);
  });

  it("requires a phone and non-empty text to simulate", () => {
    expect(SimulateRequest.safeParse({ phone: "+60123456789", text: "" }).success).toBe(false);
    expect(SimulateRequest.safeParse({ phone: "+60123456789", text: "Hai" }).success).toBe(true);
  });

  it("wraps events in stream messages", () => {
    expect(StreamMessage.parse({ type: "event.created", event }).event.id).toBe("evt_1");
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run packages/shared`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 6: Implement the contracts**

`packages/shared/src/elder.ts`:
```ts
import { z } from "zod";

export const Elder = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string().nullable(),
  language: z.string().nullable(),
  createdAt: z.string(),
});
export type Elder = z.infer<typeof Elder>;
```

`packages/shared/src/family.ts`:
```ts
import { z } from "zod";

export const FamilyMember = z.object({
  id: z.string(),
  elderId: z.string(),
  name: z.string().nullable(),
  phone: z.string(),
  createdAt: z.string(),
});
export type FamilyMember = z.infer<typeof FamilyMember>;
```

`packages/shared/src/event.ts`:
```ts
import { z } from "zod";

export const EventType = z.enum(["bill_explained", "scam_detected", "high_risk_action", "reminder_created"]);
export type EventType = z.infer<typeof EventType>;

export const Severity = z.enum(["low", "med", "high"]);
export type Severity = z.infer<typeof Severity>;

export const EventStatus = z.enum(["new", "approved", "dismissed", "resolved"]);
export type EventStatus = z.infer<typeof EventStatus>;

export const DocumentKind = z.enum(["bill", "letter", "appointment", "other"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const CareEvent = z.object({
  id: z.string(),
  elderId: z.string(),
  type: EventType,
  severity: Severity,
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()),
  status: EventStatus,
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
});
export type CareEvent = z.infer<typeof CareEvent>;
```

`packages/shared/src/reminder.ts`:
```ts
import { z } from "zod";

export const ReminderStatus = z.enum(["scheduled", "sent", "cancelled"]);
export type ReminderStatus = z.infer<typeof ReminderStatus>;

export const Reminder = z.object({
  id: z.string(),
  elderId: z.string(),
  what: z.string(),
  dueText: z.string(),
  dueAt: z.string().nullable(),
  status: ReminderStatus,
  createdAt: z.string(),
});
export type Reminder = z.infer<typeof Reminder>;
```

`packages/shared/src/api.ts`:
```ts
import { z } from "zod";
import type { Elder } from "./elder.js";
import { CareEvent, EventStatus, Severity } from "./event.js";
import type { Reminder } from "./reminder.js";

export const ListEventsQuery = z.object({
  elderId: z.string().optional(),
  status: EventStatus.optional(),
  severity: Severity.optional(),
  since: z.iso.datetime().optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuery>;

export const ListRemindersQuery = z.object({ elderId: z.string().optional() });
export type ListRemindersQuery = z.infer<typeof ListRemindersQuery>;

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof ApiError>;

export const StreamMessage = z.object({
  type: z.enum(["event.created", "event.updated"]),
  event: CareEvent,
});
export type StreamMessage = z.infer<typeof StreamMessage>;

export const SimulateRequest = z.object({ phone: z.string().min(1), text: z.string().min(1) });
export type SimulateRequest = z.infer<typeof SimulateRequest>;

export const OutboundMessage = z.object({ to: z.string(), body: z.string() });
export type OutboundMessage = z.infer<typeof OutboundMessage>;

export type EventListResponse = { events: CareEvent[] };
export type ElderListResponse = { elders: Elder[] };
export type ReminderListResponse = { reminders: Reminder[] };
export type SimulateResponse = { reply: string | null; sent: OutboundMessage[]; events: CareEvent[] };
```

`packages/shared/src/index.ts`:
```ts
export * from "./api.js";
export * from "./elder.js";
export * from "./event.js";
export * from "./family.js";
export * from "./reminder.js";
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run packages/shared && npm run typecheck -w @careguard/shared`
Expected: 5 tests PASS; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore tsconfig.base.json vitest.config.ts packages/shared
git commit -m "build: npm workspaces and @careguard/shared zod contracts"
```

---

### Task 2: API package, config, errors and SQLite

**Files:**
- Modify: `vitest.config.ts`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/errors.ts`, `apps/api/src/infra/config.ts`, `apps/api/src/infra/db.ts`, `apps/api/src/infra/ids.ts`, `apps/api/src/infra/migrations/001_init.sql`, `apps/api/src/test/db.ts`
- Test: `apps/api/src/infra/config.test.ts`, `apps/api/src/infra/db.test.ts`

**Interfaces:**
- Produces:
  - `errors.ts`: `class AppError extends Error { code: string }`, `NotFoundError`, `ConflictError`, `ValidationError` (codes `not_found`, `conflict`, `validation_error`)
  - `infra/config.ts`: `interface Config { env: "development"|"test"|"production"; port: number; databasePath: string; publicUrl?: string; dashboardOrigin: string; model: string; seedDemo: boolean; openai?: { apiKey: string; baseUrl?: string }; twilio?: { accountSid: string; authToken: string; from: string }; exaApiKey?: string; safeBrowsingKey?: string; fallbacks: string[] }`, `class ConfigError`, `loadConfig(source?: Record<string, string | undefined>): Config`
  - `infra/db.ts`: `type Db = Database.Database`, `openDb(path: string): Db`, `migrate(db: Db, dir?: string): string[]`
  - `infra/ids.ts`: `newId(prefix: "eld" | "fam" | "evt" | "rem"): string`
  - `test/db.ts`: `createTestDb(): Db`

- [ ] **Step 1: Create the API package**

`apps/api/package.json`:
```json
{
  "name": "@careguard/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "cli": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@careguard/shared": "*",
    "better-sqlite3": "^12.11.1",
    "dotenv": "^16.6.1",
    "express": "^5.2.1",
    "openai": "^4.104.0",
    "tsx": "^4.23.13",
    "zod": "^4.6.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^9.6.0",
    "@types/express": "^5.0.6",
    "@types/supertest": "^7.2.1",
    "supertest": "^7.2.2"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "api", include: ["src/**/*.test.ts"], environment: "node" },
});
```

Root `vitest.config.ts` — change the projects line to:
```ts
  test: { projects: ["packages/shared", "apps/api"] },
```

Run: `npm install`
Expected: completes. Then verify the SQLite binding loads:
Run: `node -e "const D=require('better-sqlite3'); console.log(new D(':memory:').prepare('select 1 as ok').get())"`
Expected: `{ ok: 1 }` (a segfault / exit 139 means version 13 slipped in — check `npm ls better-sqlite3`).

- [ ] **Step 2: Write the failing config and db tests**

`apps/api/src/infra/config.test.ts`:
```ts
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
```

`apps/api/src/infra/db.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";

describe("openDb", () => {
  it("applies migrations and creates every table", () => {
    const db = openDb(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    expect(tables).toEqual(
      expect.arrayContaining(["elders", "events", "family_members", "messages", "reminders", "schema_migrations"]),
    );
  });

  it("does not re-apply migrations", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toEqual([]);
  });

  it("enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() =>
      db
        .prepare(
          "INSERT INTO events (id, elder_id, type, severity, summary, created_at) VALUES ('evt_x', 'eld_missing', 'scam_detected', 'high', 's', '2026-09-13T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run apps/api/src/infra`
Expected: FAIL — cannot resolve `./config.js` and `./db.js`.

- [ ] **Step 4: Implement errors, ids, config**

`apps/api/src/errors.ts`:
```ts
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super("not_found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("conflict", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("validation_error", message);
  }
}
```

`apps/api/src/infra/ids.ts`:
```ts
import { randomUUID } from "node:crypto";

export function newId(prefix: "eld" | "fam" | "evt" | "rem"): string {
  return `${prefix}_${randomUUID()}`;
}
```

`apps/api/src/infra/config.ts`:
```ts
import { z } from "zod";

export class ConfigError extends Error {
  name = "ConfigError";
}

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  databasePath: string;
  publicUrl?: string;
  dashboardOrigin: string;
  model: string;
  seedDemo: boolean;
  openai?: { apiKey: string; baseUrl?: string };
  twilio?: { accountSid: string; authToken: string; from: string };
  exaApiKey?: string;
  safeBrowsingKey?: string;
  /** Integrations running in degraded mode, e.g. "search:null". Logged at startup and on /health. */
  fallbacks: string[];
}

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/careguard.db"),
  PUBLIC_URL: z.url().optional(),
  DASHBOARD_ORIGIN: z.string().default("http://localhost:3000"),
  MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  GOOGLE_SAFE_BROWSING_KEY: z.string().optional(),
  SEED_DEMO: z.enum(["true", "false", "1", "0"]).optional(),
});

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  // Blank values in .env (e.g. "EXA_API_KEY=") mean "not set".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) throw new ConfigError(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  const e = parsed.data;

  if (e.NODE_ENV === "production") {
    const missing = (
      ["OPENAI_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "PUBLIC_URL"] as const
    ).filter((key) => !e[key]);
    if (missing.length > 0) throw new ConfigError(`Missing required production settings: ${missing.join(", ")}`);
  }

  const openai = e.OPENAI_API_KEY ? { apiKey: e.OPENAI_API_KEY, baseUrl: e.OPENAI_BASE_URL } : undefined;
  const twilio =
    e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_WHATSAPP_FROM
      ? { accountSid: e.TWILIO_ACCOUNT_SID, authToken: e.TWILIO_AUTH_TOKEN, from: e.TWILIO_WHATSAPP_FROM }
      : undefined;

  const fallbacks: string[] = [];
  if (!openai) fallbacks.push("llm:disabled");
  if (!twilio) fallbacks.push("messenger:console");
  if (!twilio || !e.PUBLIC_URL) fallbacks.push("twilio-signature:off");
  if (!e.EXA_API_KEY) fallbacks.push("search:null");
  if (!e.GOOGLE_SAFE_BROWSING_KEY) fallbacks.push("url-reputation:offline");

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicUrl: e.PUBLIC_URL,
    dashboardOrigin: e.DASHBOARD_ORIGIN,
    model: e.MODEL,
    seedDemo: e.SEED_DEMO === "true" || e.SEED_DEMO === "1",
    openai,
    twilio,
    exaApiKey: e.EXA_API_KEY,
    safeBrowsingKey: e.GOOGLE_SAFE_BROWSING_KEY,
    fallbacks,
  };
}
```

- [ ] **Step 5: Implement the migration and database**

`apps/api/src/infra/migrations/001_init.sql`:
```sql
CREATE TABLE elders (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  name        TEXT,
  language    TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE family_members (
  id          TEXT PRIMARY KEY,
  elder_id    TEXT NOT NULL REFERENCES elders(id),
  name        TEXT,
  phone       TEXT NOT NULL,
  auth0_sub   TEXT UNIQUE,
  created_at  TEXT NOT NULL,
  UNIQUE (elder_id, phone)
);

CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id     TEXT NOT NULL REFERENCES elders(id),
  external_id  TEXT UNIQUE,
  payload      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX messages_elder ON messages (elder_id, id);

CREATE TABLE events (
  id           TEXT PRIMARY KEY,
  elder_id     TEXT NOT NULL REFERENCES elders(id),
  type         TEXT NOT NULL,
  severity     TEXT NOT NULL,
  summary      TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TEXT NOT NULL,
  resolved_at  TEXT,
  resolved_by  TEXT REFERENCES family_members(id)
);
CREATE INDEX events_feed ON events (elder_id, status, created_at);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  elder_id    TEXT NOT NULL REFERENCES elders(id),
  what        TEXT NOT NULL,
  due_text    TEXT NOT NULL,
  due_at      TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',
  job_id      TEXT,
  created_at  TEXT NOT NULL
);
```

`apps/api/src/infra/db.ts`:
```ts
import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Applies unapplied `NNN_*.sql` files in filename order. Returns the names it ran. */
export function migrate(db: Db, dir = MIGRATIONS_DIR): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").pluck().all() as string[]);
  const pending = readdirSync(dir)
    .filter((file) => file.endsWith(".sql") && !applied.has(file))
    .sort();

  for (const file of pending) {
    const sql = readFileSync(join(dir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
    })();
  }
  return pending;
}
```

`apps/api/src/test/db.ts`:
```ts
import { openDb, type Db } from "../infra/db.js";

export function createTestDb(): Db {
  return openDb(":memory:");
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/api/src/infra && npm run typecheck -w @careguard/api`
Expected: 11 tests PASS; `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package-lock.json apps/api/package.json apps/api/tsconfig.json apps/api/vitest.config.ts apps/api/src/errors.ts apps/api/src/infra apps/api/src/test/db.ts
git commit -m "feat(api): validated config, domain errors, SQLite with migrations"
```

---

### Task 3: Ports, adapters, phone helpers, tool contract and test fakes

**Files:**
- Create: `apps/api/src/ports/{clock,logger,messenger,search,url-reputation,scheduler,llm}.ts`
- Create: `apps/api/src/adapters/{system-clock,console-logger,console-messenger,capturing-messenger,twilio-messenger,twilio-media,exa-search,null-search,safe-browsing,offline-url-reputation,openai-llm,in-process-scheduler}.ts`
- Create: `apps/api/src/phone.ts`, `apps/api/src/agent/tool.ts`, `apps/api/src/test/fakes.ts`
- Test: `apps/api/src/phone.test.ts`, `apps/api/src/adapters/adapters.test.ts`, `apps/api/src/adapters/in-process-scheduler.test.ts`, `apps/api/src/agent/tool.test.ts`

**Interfaces:**
- Consumes: `OutboundMessage`, `Elder` from `@careguard/shared`.
- Produces:
  - `Clock { now(): Date }` · `Logger { info(msg, meta?); warn(msg, meta?); error(msg, meta?) }` (meta: `Record<string, unknown>`)
  - `Messenger { send(msg: OutboundMessage): Promise<boolean> }`
  - `SearchResult { title: string; url: string; text?: string }` · `Search { search(query: string, numResults: number): Promise<SearchResult[]> }` (never throws)
  - `UrlReputation { isUnsafe(url: string): Promise<boolean | null> }` (`null` = unknown)
  - `ScheduledJob { id: string; runAt: Date; run(): Promise<void> }` · `Scheduler { schedule(job): string; cancel(id: string): void }`
  - `LlmRequest { system: string; messages: ChatCompletionMessageParam[]; tools: ChatCompletionTool[] }` · `Llm { complete(req): Promise<ChatCompletionMessage> }`
  - `systemClock`, `createConsoleLogger({ minLevel? })`, `createConsoleMessenger(log)`, `class CapturingMessenger { sent: OutboundMessage[]; constructor(succeed = true) }`, `createTwilioMessenger(opts, log)`, `type MediaFetcher = (url: string) => Promise<string | null>`, `noMedia`, `createTwilioMediaFetcher(opts, log)`, `createExaSearch(opts, log)`, `nullSearch`, `createSafeBrowsing(opts, log)`, `offlineUrlReputation`, `createOpenAiLlm(opts)`, `disabledLlm`, `createInProcessScheduler(clock, log): Scheduler & { size(): number }`
  - `phone.ts`: `toWhatsApp(phone: string): string`, `normalizePhone(raw: string): string | null`
  - `agent/tool.ts`: `ToolContext { elder: Elder; messenger: Messenger; clock: Clock; log: Logger }`, `Tool { schema: ChatCompletionTool; run(args: unknown, ctx: ToolContext): Promise<string> }`, `ToolSet = Record<string, Tool>`, `defineTool(def: { name; description; input: ZodType; run(input, ctx) }): Tool`
  - `test/fakes.ts`: `silentLogger`, `fixedClock(iso?)` (`& { set(iso) }`), `testElder(overrides?)`, `testContext(overrides?)`, `fakeSearch(results?, delayMs?)` (`& { queries: string[] }`), `fakeUrlReputation(unsafeUrls?)`, `assistantText(content)`, `assistantToolCall(name, args, id?)`, `class FakeLlm { requests: LlmRequest[]; constructor(respond: LlmResponder); static scripted(responses) }`

- [ ] **Step 1: Create the ports**

`apps/api/src/ports/clock.ts`:
```ts
export interface Clock {
  now(): Date;
}
```

`apps/api/src/ports/logger.ts`:
```ts
export type LogMeta = Record<string, unknown>;

export interface Logger {
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
}
```

`apps/api/src/ports/messenger.ts`:
```ts
import type { OutboundMessage } from "@careguard/shared";

export interface Messenger {
  /** Resolves false when the message could not be delivered. Never throws. */
  send(message: OutboundMessage): Promise<boolean>;
}
```

`apps/api/src/ports/search.ts`:
```ts
export interface SearchResult {
  title: string;
  url: string;
  text?: string;
}

export interface Search {
  /** Resolves [] on any failure. Never throws. */
  search(query: string, numResults: number): Promise<SearchResult[]>;
}
```

`apps/api/src/ports/url-reputation.ts`:
```ts
export interface UrlReputation {
  /** true = known unsafe, false = checked and clean, null = could not check. */
  isUnsafe(url: string): Promise<boolean | null>;
}
```

`apps/api/src/ports/scheduler.ts`:
```ts
export interface ScheduledJob {
  id: string;
  runAt: Date;
  run(): Promise<void>;
}

export interface Scheduler {
  /** Returns the job id used by the backing scheduler. */
  schedule(job: ScheduledJob): string;
  cancel(id: string): void;
}
```

`apps/api/src/ports/llm.ts`:
```ts
import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

export interface LlmRequest {
  system: string;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
}

export interface Llm {
  complete(request: LlmRequest): Promise<ChatCompletionMessage>;
}
```

- [ ] **Step 2: Write the failing phone, adapter, scheduler and tool tests**

`apps/api/src/phone.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizePhone, toWhatsApp } from "./phone.js";

describe("phone helpers", () => {
  it("adds the whatsapp: prefix once", () => {
    expect(toWhatsApp("+60123456789")).toBe("whatsapp:+60123456789");
    expect(toWhatsApp("whatsapp:+60123456789")).toBe("whatsapp:+60123456789");
  });

  it.each([
    ["012-345 6789", "+60123456789"],
    ["60123456789", "+60123456789"],
    ["+60 12-345 6789", "+60123456789"],
    ["whatsapp:+60123456789", "+60123456789"],
  ])("normalises %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(["12345", "abc", ""])("rejects %j", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});
```

`apps/api/src/adapters/adapters.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../test/fakes.js";
import { createExaSearch } from "./exa-search.js";
import { createSafeBrowsing } from "./safe-browsing.js";
import { createTwilioMediaFetcher } from "./twilio-media.js";
import { createTwilioMessenger } from "./twilio-messenger.js";

type FetchCall = [string, RequestInit];
const asFetch = (fn: (url: string, init: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

describe("createTwilioMessenger", () => {
  const opts = { accountSid: "AC123", authToken: "secret", from: "whatsapp:+14155238886" };

  it("posts a WhatsApp message to the Twilio Messages API", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 201 }));
    const messenger = createTwilioMessenger({ ...opts, fetch: asFetch(fetchMock) }, silentLogger);

    await expect(messenger.send({ to: "+60123456789", body: "Hai Mak" })).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("AC123:secret").toString("base64")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      From: "whatsapp:+14155238886",
      To: "whatsapp:+60123456789",
      Body: "Hai Mak",
    });
  });

  it("returns false on a non-2xx response", async () => {
    const messenger = createTwilioMessenger(
      { ...opts, fetch: asFetch(async () => new Response("bad", { status: 400 })) },
      silentLogger,
    );
    await expect(messenger.send({ to: "+60123456789", body: "x" })).resolves.toBe(false);
  });

  it("returns false when the request throws", async () => {
    const messenger = createTwilioMessenger(
      { ...opts, fetch: asFetch(async () => { throw new Error("offline"); }) },
      silentLogger,
    );
    await expect(messenger.send({ to: "+60123456789", body: "x" })).resolves.toBe(false);
  });
});

describe("createTwilioMediaFetcher", () => {
  it("downloads media with basic auth and returns a data URL", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(Buffer.from("img"), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const fetchMedia = createTwilioMediaFetcher(
      { accountSid: "AC123", authToken: "secret", fetch: asFetch(fetchMock) },
      silentLogger,
    );
    await expect(fetchMedia("https://api.twilio.com/media/ME1")).resolves.toBe(
      `data:image/png;base64,${Buffer.from("img").toString("base64")}`,
    );
    const [, init] = fetchMock.mock.calls[0] as FetchCall;
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("returns null when the download fails", async () => {
    const fetchMedia = createTwilioMediaFetcher(
      { accountSid: "AC123", authToken: "secret", fetch: asFetch(async () => new Response("", { status: 404 })) },
      silentLogger,
    );
    await expect(fetchMedia("https://api.twilio.com/media/ME1")).resolves.toBeNull();
  });
});

describe("createExaSearch", () => {
  it("sends the query with the API key and maps results", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ results: [{ title: "Scam alert", url: "https://a.example", text: "t" }, { title: null, url: "https://b.example" }] })),
    );
    const search = createExaSearch({ apiKey: "exa-key", fetch: asFetch(fetchMock) }, silentLogger);

    await expect(search.search("012-3456789 scam", 2)).resolves.toEqual([
      { title: "Scam alert", url: "https://a.example", text: "t" },
      { title: "https://b.example", url: "https://b.example", text: undefined },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as FetchCall;
    expect(url).toBe("https://api.exa.ai/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("exa-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "012-3456789 scam", numResults: 2 });
  });

  it("returns [] on failure", async () => {
    const search = createExaSearch(
      { apiKey: "exa-key", fetch: asFetch(async () => new Response("down", { status: 500 })) },
      silentLogger,
    );
    await expect(search.search("q", 2)).resolves.toEqual([]);
  });
});

describe("createSafeBrowsing", () => {
  const withBody = (body: unknown, status = 200) =>
    createSafeBrowsing({ apiKey: "gsb", fetch: asFetch(async () => new Response(JSON.stringify(body), { status })) }, silentLogger);

  it("reports true when Google has a match", async () => {
    await expect(withBody({ matches: [{ threatType: "SOCIAL_ENGINEERING" }] }).isUnsafe("http://bad.example")).resolves.toBe(true);
  });

  it("reports false when there are no matches", async () => {
    await expect(withBody({}).isUnsafe("http://ok.example")).resolves.toBe(false);
  });

  it("reports null when the check fails", async () => {
    await expect(withBody({}, 500).isUnsafe("http://ok.example")).resolves.toBeNull();
  });
});
```

`apps/api/src/adapters/in-process-scheduler.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedClock, silentLogger } from "../test/fakes.js";
import { createInProcessScheduler } from "./in-process-scheduler.js";

describe("createInProcessScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a job at its time", async () => {
    const scheduler = createInProcessScheduler(fixedClock("2026-09-13T03:00:00.000Z"), silentLogger);
    const run = vi.fn(async () => {});
    scheduler.schedule({ id: "rem_1", runAt: new Date("2026-09-13T03:10:00.000Z"), run });

    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.size()).toBe(0);
  });

  it("cancels a job", async () => {
    const scheduler = createInProcessScheduler(fixedClock("2026-09-13T03:00:00.000Z"), silentLogger);
    const run = vi.fn(async () => {});
    scheduler.schedule({ id: "rem_1", runAt: new Date("2026-09-13T03:01:00.000Z"), run });
    scheduler.cancel("rem_1");

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.size()).toBe(0);
  });

  it("survives a failing job", async () => {
    const scheduler = createInProcessScheduler(fixedClock("2026-09-13T03:00:00.000Z"), silentLogger);
    scheduler.schedule({ id: "rem_1", runAt: new Date("2026-09-13T03:00:01.000Z"), run: async () => { throw new Error("boom"); } });
    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
  });
});
```

`apps/api/src/agent/tool.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testContext } from "../test/fakes.js";
import { defineTool } from "./tool.js";

const echo = defineTool({
  name: "echo",
  description: "Echo text back.",
  input: z.object({
    text: z.string().describe("Text to echo"),
    times: z.number().optional(),
  }),
  run: async ({ text, times }, ctx) => `${ctx.elder.id}:${text.repeat(times ?? 1)}`,
});

describe("defineTool", () => {
  it("builds an OpenAI function schema from the zod input", () => {
    expect(echo.schema.type).toBe("function");
    expect(echo.schema.function.name).toBe("echo");
    expect(echo.schema.function.description).toBe("Echo text back.");
    expect(echo.schema.function.parameters).toMatchObject({
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
    });
    expect(echo.schema.function.parameters).not.toHaveProperty("$schema");
  });

  it("returns a message instead of running when arguments are invalid", async () => {
    await expect(echo.run({ times: 2 }, testContext())).resolves.toMatch(/^Invalid arguments for echo/);
  });

  it("passes parsed input and context to run", async () => {
    await expect(echo.run({ text: "hi", times: 2 }, testContext())).resolves.toBe("eld_1:hihi");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run apps/api/src/phone.test.ts apps/api/src/adapters apps/api/src/agent/tool.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `phone.ts` and the simple adapters**

`apps/api/src/phone.ts`:
```ts
/** Twilio addresses WhatsApp users as `whatsapp:+<E.164>`. Elders are keyed by that form. */
export function toWhatsApp(phone: string): string {
  return phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`;
}

/** Normalises Malaysian-style input (`012-345 6789`, `60123456789`, `whatsapp:+60…`) to `+60…`. */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[^\d+]/g, "");
  const withPlus = compact.startsWith("+")
    ? compact
    : compact.startsWith("60")
      ? `+${compact}`
      : compact.startsWith("0")
        ? `+6${compact}`
        : `+${compact}`;
  return /^\+\d{8,15}$/.test(withPlus) ? withPlus : null;
}
```

`apps/api/src/adapters/system-clock.ts`:
```ts
import type { Clock } from "../ports/clock.js";

export const systemClock: Clock = { now: () => new Date() };
```

`apps/api/src/adapters/console-logger.ts`:
```ts
import type { LogMeta, Logger } from "../ports/logger.js";

type Level = "info" | "warn" | "error";
const ORDER: Record<Level, number> = { info: 20, warn: 30, error: 40 };

/** JSON-lines logger (Cloud Run parses these into structured logs). */
export function createConsoleLogger({ minLevel = "info" }: { minLevel?: Level } = {}): Logger {
  const emit = (level: Level) => (msg: string, meta: LogMeta = {}) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = JSON.stringify({ severity: level.toUpperCase(), msg, time: new Date().toISOString(), ...meta });
    if (level === "info") console.log(line);
    else console.error(line);
  };
  return { info: emit("info"), warn: emit("warn"), error: emit("error") };
}
```

`apps/api/src/adapters/console-messenger.ts`:
```ts
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";

/** Used when Twilio is not configured: logs what would have been sent. */
export function createConsoleMessenger(log: Logger): Messenger {
  return {
    async send({ to, body }) {
      log.info("outbound message (console messenger — Twilio not configured)", { to, body });
      return true;
    },
  };
}
```

`apps/api/src/adapters/capturing-messenger.ts`:
```ts
import type { OutboundMessage } from "@careguard/shared";
import type { Messenger } from "../ports/messenger.js";

/** Records messages instead of sending them. Used by /dev/simulate, the CLI, and tests. */
export class CapturingMessenger implements Messenger {
  readonly sent: OutboundMessage[] = [];

  constructor(private readonly succeed = true) {}

  async send(message: OutboundMessage): Promise<boolean> {
    this.sent.push(message);
    return this.succeed;
  }
}
```

`apps/api/src/adapters/null-search.ts`:
```ts
import type { Search } from "../ports/search.js";

export const nullSearch: Search = { search: async () => [] };
```

`apps/api/src/adapters/offline-url-reputation.ts`:
```ts
import type { UrlReputation } from "../ports/url-reputation.js";

export const offlineUrlReputation: UrlReputation = { isUnsafe: async () => null };
```

- [ ] **Step 5: Implement the network adapters**

`apps/api/src/adapters/twilio-messenger.ts`:
```ts
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";
import { toWhatsApp } from "../phone.js";

export interface TwilioMessengerOptions {
  accountSid: string;
  authToken: string;
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createTwilioMessenger(opts: TwilioMessengerOptions, log: Logger): Messenger {
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64")}`;

  return {
    async send({ to, body }) {
      try {
        const res = await doFetch(`https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: toWhatsApp(opts.from), To: toWhatsApp(to), Body: body }).toString(),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          log.warn("twilio send failed", { status: res.status, to });
          return false;
        }
        return true;
      } catch (err) {
        log.warn("twilio send error", { error: (err as Error).message, to });
        return false;
      }
    },
  };
}
```

`apps/api/src/adapters/twilio-media.ts`:
```ts
import type { Logger } from "../ports/logger.js";

/** Downloads an inbound media URL and returns it as a data URL the vision model can read. */
export type MediaFetcher = (url: string) => Promise<string | null>;

export const noMedia: MediaFetcher = async () => null;

export function createTwilioMediaFetcher(
  opts: { accountSid: string; authToken: string; fetch?: typeof fetch; timeoutMs?: number },
  log: Logger,
): MediaFetcher {
  const doFetch = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64")}`;

  return async (url) => {
    try {
      const res = await doFetch(url, {
        headers: { Authorization: auth },
        redirect: "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        log.warn("media download failed", { status: res.status });
        return null;
      }
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    } catch (err) {
      log.warn("media download error", { error: (err as Error).message });
      return null;
    }
  };
}
```

`apps/api/src/adapters/exa-search.ts`:
```ts
import type { Logger } from "../ports/logger.js";
import type { Search } from "../ports/search.js";

export function createExaSearch(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }, log: Logger): Search {
  const doFetch = opts.fetch ?? fetch;

  return {
    async search(query, numResults) {
      try {
        const res = await doFetch("https://api.exa.ai/search", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": opts.apiKey },
          body: JSON.stringify({ query, numResults, type: "auto", contents: { text: { maxCharacters: 1200 } } }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          log.warn("exa search failed", { status: res.status });
          return [];
        }
        const data = (await res.json()) as { results?: Array<{ title?: string | null; url: string; text?: string }> };
        return (data.results ?? []).map((r) => ({ title: r.title ?? r.url, url: r.url, text: r.text }));
      } catch (err) {
        log.warn("exa search error", { error: (err as Error).message });
        return [];
      }
    },
  };
}
```

`apps/api/src/adapters/safe-browsing.ts`:
```ts
import type { Logger } from "../ports/logger.js";
import type { UrlReputation } from "../ports/url-reputation.js";

export function createSafeBrowsing(
  opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number },
  log: Logger,
): UrlReputation {
  const doFetch = opts.fetch ?? fetch;

  return {
    async isUnsafe(url) {
      try {
        const res = await doFetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${opts.apiKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client: { clientId: "careguard", clientVersion: "1.0" },
            threatInfo: {
              threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
              platformTypes: ["ANY_PLATFORM"],
              threatEntryTypes: ["URL"],
              threatEntries: [{ url }],
            },
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!res.ok) {
          log.warn("safe browsing check failed", { status: res.status });
          return null;
        }
        const data = (await res.json()) as { matches?: unknown[] };
        return Array.isArray(data.matches) && data.matches.length > 0;
      } catch (err) {
        log.warn("safe browsing check error", { error: (err as Error).message });
        return null;
      }
    },
  };
}
```

`apps/api/src/adapters/openai-llm.ts`:
```ts
import OpenAI from "openai";
import type { Llm } from "../ports/llm.js";

export function createOpenAiLlm(opts: { apiKey: string; baseUrl?: string; model: string; timeoutMs?: number }): Llm {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl, timeout: opts.timeoutMs ?? 30_000, maxRetries: 1 });

  return {
    async complete({ system, messages, tools }) {
      const completion = await client.chat.completions.create({
        model: opts.model,
        messages: [{ role: "system", content: system }, ...messages],
        tools,
        tool_choice: "auto",
      });
      const message = completion.choices[0]?.message;
      if (!message) throw new Error("LLM returned no choices");
      return message;
    },
  };
}

/** Used when OPENAI_API_KEY is unset: every turn fails and the elder gets the fallback reply. */
export const disabledLlm: Llm = {
  complete: async () => {
    throw new Error("OPENAI_API_KEY is not set");
  },
};
```

`apps/api/src/adapters/in-process-scheduler.ts`:
```ts
import type { Clock } from "../ports/clock.js";
import type { Logger } from "../ports/logger.js";
import type { Scheduler } from "../ports/scheduler.js";

const MAX_TIMEOUT_MS = 2_147_483_647; // ~24.8 days, the setTimeout ceiling

/** setTimeout-backed scheduler. Jobs are lost on restart — callers re-register them at boot. */
export function createInProcessScheduler(clock: Clock, log: Logger): Scheduler & { size(): number } {
  const timers = new Map<string, NodeJS.Timeout>();

  return {
    schedule(job) {
      const delay = Math.max(0, job.runAt.getTime() - clock.now().getTime());
      if (delay > MAX_TIMEOUT_MS) {
        log.warn("job is beyond the in-process scheduler range; not scheduled", { id: job.id });
        return job.id;
      }
      const timer = setTimeout(() => {
        timers.delete(job.id);
        job.run().catch((err: unknown) => {
          log.error("scheduled job failed", { id: job.id, error: err instanceof Error ? err.message : String(err) });
        });
      }, delay);
      timers.set(job.id, timer);
      return job.id;
    },
    cancel(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    },
    size: () => timers.size,
  };
}
```

- [ ] **Step 6: Implement the tool contract and test fakes**

`apps/api/src/agent/tool.ts`:
```ts
import type { Elder } from "@careguard/shared";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import type { Clock } from "../ports/clock.js";
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";

/** Everything a tool may know about the current turn. There is no other per-turn state. */
export interface ToolContext {
  elder: Elder;
  messenger: Messenger;
  clock: Clock;
  log: Logger;
}

export interface Tool {
  schema: ChatCompletionTool;
  run(args: unknown, ctx: ToolContext): Promise<string>;
}

export type ToolSet = Record<string, Tool>;

export interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<string>;
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): Tool {
  const { $schema: _schemaUri, ...parameters } = z.toJSONSchema(def.input) as Record<string, unknown>;

  return {
    schema: { type: "function", function: { name: def.name, description: def.description, parameters } },
    async run(args, ctx) {
      const parsed = def.input.safeParse(args);
      if (!parsed.success) return `Invalid arguments for ${def.name}:\n${z.prettifyError(parsed.error)}`;
      return def.run(parsed.data, ctx);
    },
  };
}
```

`apps/api/src/test/fakes.ts`:
```ts
import type { Elder } from "@careguard/shared";
import type { ChatCompletionMessage } from "openai/resources/chat/completions";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import type { ToolContext } from "../agent/tool.js";
import type { Clock } from "../ports/clock.js";
import type { Llm, LlmRequest } from "../ports/llm.js";
import type { Logger } from "../ports/logger.js";
import type { Search, SearchResult } from "../ports/search.js";
import type { UrlReputation } from "../ports/url-reputation.js";

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export function fixedClock(iso = "2026-09-13T03:00:00.000Z"): Clock & { set(iso: string): void } {
  let now = new Date(iso);
  return {
    now: () => new Date(now),
    set(next) {
      now = new Date(next);
    },
  };
}

export function testElder(overrides: Partial<Elder> = {}): Elder {
  return {
    id: "eld_1",
    phone: "whatsapp:+60123456789",
    name: "Mak",
    language: null,
    createdAt: "2026-09-13T03:00:00.000Z",
    ...overrides,
  };
}

export function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return { elder: testElder(), messenger: new CapturingMessenger(), clock: fixedClock(), log: silentLogger, ...overrides };
}

export function fakeSearch(results: SearchResult[] = [], delayMs = 0): Search & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async search(query) {
      queries.push(query);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return results;
    },
  };
}

export function fakeUrlReputation(unsafeUrls: string[] = []): UrlReputation {
  return { isUnsafe: async (url) => unsafeUrls.includes(url) };
}

export function assistantText(content: string): ChatCompletionMessage {
  return { role: "assistant", content, refusal: null };
}

export function assistantToolCall(name: string, args: Record<string, unknown>, id = `call_${name}`): ChatCompletionMessage {
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

export type LlmResponder = (request: LlmRequest, callIndex: number) => ChatCompletionMessage | Promise<ChatCompletionMessage>;

export class FakeLlm implements Llm {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly respond: LlmResponder) {}

  static scripted(responses: ChatCompletionMessage[]): FakeLlm {
    return new FakeLlm((_request, index) => {
      const response = responses[index];
      if (!response) throw new Error(`FakeLlm script exhausted at call ${index}`);
      return response;
    });
  }

  async complete(request: LlmRequest): Promise<ChatCompletionMessage> {
    const index = this.requests.length;
    this.requests.push(structuredClone(request));
    return this.respond(request, index);
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run apps/api/src/phone.test.ts apps/api/src/adapters apps/api/src/agent/tool.test.ts && npm run typecheck -w @careguard/api`
Expected: all PASS; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/ports apps/api/src/adapters apps/api/src/phone.ts apps/api/src/phone.test.ts apps/api/src/agent/tool.ts apps/api/src/agent/tool.test.ts apps/api/src/test/fakes.ts
git commit -m "feat(api): ports, adapters, phone helpers, zod-backed tool contract, test fakes"
```

---

### Task 4: Elders and conversation modules

**Files:**
- Create: `apps/api/src/modules/elders/repo.ts`, `apps/api/src/modules/elders/service.ts`, `apps/api/src/modules/conversation/repo.ts`, `apps/api/src/modules/conversation/service.ts`
- Test: `apps/api/src/modules/elders/service.test.ts`, `apps/api/src/modules/conversation/service.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 2), `newId`, `NotFoundError`, `Clock`, `fixedClock`, `createTestDb`.
- Produces:
  - `createEldersRepo(db)`, `interface EldersService { findOrCreateByPhone(phone: string, name?: string | null): Elder; get(id: string): Elder; list(): Elder[] }`, `createEldersService({ repo, clock }): EldersService`
  - `HISTORY_LIMIT = 30`, `PHOTO_PLACEHOLDER = "[photo]"`, `stripImages(message: ChatCompletionMessageParam): ChatCompletionMessageParam`, `createConversationRepo(db)`, `interface ConversationService { appendInbound(elderId: string, message: ChatCompletionUserMessageParam, externalId?: string | null): boolean; append(elderId: string, messages: ChatCompletionMessageParam[]): void; window(elderId: string): ChatCompletionMessageParam[] }`, `createConversationService({ repo, clock }): ConversationService`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/elders/service.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../errors.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock } from "../../test/fakes.js";
import { createEldersRepo } from "./repo.js";
import { createEldersService } from "./service.js";

function setup() {
  const clock = fixedClock();
  return { clock, elders: createEldersService({ repo: createEldersRepo(createTestDb()), clock }) };
}

describe("EldersService", () => {
  it("creates an elder on first contact and reuses it afterwards", () => {
    const { elders } = setup();
    const first = elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
    const again = elders.findOrCreateByPhone("whatsapp:+60123456789");

    expect(first).toMatchObject({ phone: "whatsapp:+60123456789", name: "Mak", language: null, createdAt: "2026-09-13T03:00:00.000Z" });
    expect(first.id).toMatch(/^eld_/);
    expect(again).toEqual(first);
    expect(elders.list()).toHaveLength(1);
  });

  it("lists elders oldest first", () => {
    const { elders, clock } = setup();
    elders.findOrCreateByPhone("whatsapp:+60111111111", "Mak");
    clock.set("2026-09-13T04:00:00.000Z");
    elders.findOrCreateByPhone("whatsapp:+60122222222", "Tok");
    expect(elders.list().map((e) => e.name)).toEqual(["Mak", "Tok"]);
  });

  it("throws NotFoundError for an unknown id", () => {
    const { elders } = setup();
    expect(() => elders.get("eld_missing")).toThrow(NotFoundError);
  });
});
```

`apps/api/src/modules/conversation/service.test.ts`:
```ts
import type { ChatCompletionMessageParam, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test/db.js";
import { fixedClock } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createConversationRepo } from "./repo.js";
import { createConversationService, HISTORY_LIMIT, stripImages } from "./service.js";

const user = (text: string): ChatCompletionUserMessageParam => ({ role: "user", content: [{ type: "text", text }] });

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const mak = createEldersService({ repo: createEldersRepo(db), clock }).findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  return { mak, conversation: createConversationService({ repo: createConversationRepo(db), clock }) };
}

describe("ConversationService", () => {
  it("returns an empty window for an elder with no messages", () => {
    const { mak, conversation } = setup();
    expect(conversation.window(mak.id)).toEqual([]);
  });

  it("persists messages in order", () => {
    const { mak, conversation } = setup();
    conversation.appendInbound(mak.id, user("Hai"), "SM1");
    conversation.append(mak.id, [{ role: "assistant", content: "Hai Mak!" }]);
    expect(conversation.window(mak.id)).toEqual([user("Hai"), { role: "assistant", content: "Hai Mak!" }]);
  });

  it("ignores a duplicate inbound message id", () => {
    const { mak, conversation } = setup();
    expect(conversation.appendInbound(mak.id, user("Hai"), "SM1")).toBe(true);
    expect(conversation.appendInbound(mak.id, user("Hai"), "SM1")).toBe(false);
    expect(conversation.appendInbound(mak.id, user("No id"))).toBe(true);
    expect(conversation.window(mak.id)).toHaveLength(2);
  });

  it("stores photos as [photo] text", () => {
    const { mak, conversation } = setup();
    conversation.appendInbound(mak.id, {
      role: "user",
      content: [
        { type: "text", text: "Bil apa ni?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    });
    expect(conversation.window(mak.id)).toEqual([
      { role: "user", content: [{ type: "text", text: "Bil apa ni?" }, { type: "text", text: "[photo]" }] },
    ]);
  });

  it("never starts the window in the middle of a tool exchange", () => {
    const { mak, conversation } = setup();
    // 10 exchanges × 4 messages = 40; the last 30 start at a `tool` message (index 10).
    for (let i = 0; i < 10; i++) {
      conversation.appendInbound(mak.id, user(`q${i}`));
      conversation.append(mak.id, [
        { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "log_document", arguments: "{}" } }] },
        { role: "tool", tool_call_id: `c${i}`, content: "ok" },
        { role: "assistant", content: `a${i}` },
      ]);
    }
    const window = conversation.window(mak.id);
    expect(window.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    expect(window[0]).toEqual(user("q3"));
    expect(window).toHaveLength(28);
  });

  it("leaves non-user messages untouched when stripping images", () => {
    const msg: ChatCompletionMessageParam = { role: "assistant", content: "x" };
    expect(stripImages(msg)).toBe(msg);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/api/src/modules/elders apps/api/src/modules/conversation`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the elders module**

`apps/api/src/modules/elders/repo.ts`:
```ts
import type { Elder } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface ElderRow {
  id: string;
  phone: string;
  name: string | null;
  language: string | null;
  created_at: string;
}

const toElder = (r: ElderRow): Elder => ({
  id: r.id,
  phone: r.phone,
  name: r.name,
  language: r.language,
  createdAt: r.created_at,
});

export function createEldersRepo(db: Db) {
  return {
    findByPhone(phone: string): Elder | undefined {
      const row = db.prepare("SELECT * FROM elders WHERE phone = ?").get(phone) as ElderRow | undefined;
      return row && toElder(row);
    },
    get(id: string): Elder | undefined {
      const row = db.prepare("SELECT * FROM elders WHERE id = ?").get(id) as ElderRow | undefined;
      return row && toElder(row);
    },
    list(): Elder[] {
      return (db.prepare("SELECT * FROM elders ORDER BY created_at, rowid").all() as ElderRow[]).map(toElder);
    },
    insert(elder: Elder): void {
      db.prepare("INSERT INTO elders (id, phone, name, language, created_at) VALUES (?, ?, ?, ?, ?)").run(
        elder.id,
        elder.phone,
        elder.name,
        elder.language,
        elder.createdAt,
      );
    },
  };
}

export type EldersRepo = ReturnType<typeof createEldersRepo>;
```

`apps/api/src/modules/elders/service.ts`:
```ts
import type { Elder } from "@careguard/shared";
import { NotFoundError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import type { Clock } from "../../ports/clock.js";
import type { EldersRepo } from "./repo.js";

export interface EldersService {
  findOrCreateByPhone(phone: string, name?: string | null): Elder;
  get(id: string): Elder;
  list(): Elder[];
}

export function createEldersService({ repo, clock }: { repo: EldersRepo; clock: Clock }): EldersService {
  return {
    // better-sqlite3 is synchronous, so find-then-insert cannot interleave with another request.
    findOrCreateByPhone(phone, name = null) {
      const existing = repo.findByPhone(phone);
      if (existing) return existing;
      const elder: Elder = { id: newId("eld"), phone, name, language: null, createdAt: clock.now().toISOString() };
      repo.insert(elder);
      return elder;
    },
    get(id) {
      const elder = repo.get(id);
      if (!elder) throw new NotFoundError(`Elder ${id} not found`);
      return elder;
    },
    list: () => repo.list(),
  };
}
```

- [ ] **Step 4: Implement the conversation module**

`apps/api/src/modules/conversation/repo.ts`:
```ts
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Db } from "../../infra/db.js";

export function createConversationRepo(db: Db) {
  const insert = db.prepare(
    "INSERT INTO messages (elder_id, external_id, payload, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING",
  );

  return {
    /** Returns false when `externalId` was already stored. */
    insert(elderId: string, payload: ChatCompletionMessageParam, createdAt: string, externalId: string | null): boolean {
      return insert.run(elderId, externalId, JSON.stringify(payload), createdAt).changes === 1;
    },
    insertMany(elderId: string, payloads: ChatCompletionMessageParam[], createdAt: string): void {
      db.transaction(() => {
        for (const payload of payloads) insert.run(elderId, null, JSON.stringify(payload), createdAt);
      })();
    },
    recent(elderId: string, limit: number): ChatCompletionMessageParam[] {
      const rows = db
        .prepare("SELECT payload FROM messages WHERE elder_id = ? ORDER BY id DESC LIMIT ?")
        .all(elderId, limit) as { payload: string }[];
      return rows.reverse().map((row) => JSON.parse(row.payload) as ChatCompletionMessageParam);
    },
  };
}

export type ConversationRepo = ReturnType<typeof createConversationRepo>;
```

`apps/api/src/modules/conversation/service.ts`:
```ts
import type { ChatCompletionMessageParam, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import type { Clock } from "../../ports/clock.js";
import type { ConversationRepo } from "./repo.js";

export const HISTORY_LIMIT = 30;
export const PHOTO_PLACEHOLDER = "[photo]";

export interface ConversationService {
  /** Returns false when this external message id was already stored (a Twilio retry). */
  appendInbound(elderId: string, message: ChatCompletionUserMessageParam, externalId?: string | null): boolean;
  append(elderId: string, messages: ChatCompletionMessageParam[]): void;
  /** The recent history, trimmed so it always starts at a user message. */
  window(elderId: string): ChatCompletionMessageParam[];
}

/** Images are shown to the model for one turn only; history keeps a text placeholder. */
export function stripImages(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  if (message.role !== "user" || typeof message.content === "string") return message;
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "image_url" ? { type: "text" as const, text: PHOTO_PLACEHOLDER } : part,
    ),
  };
}

export function createConversationService({ repo, clock }: { repo: ConversationRepo; clock: Clock }): ConversationService {
  return {
    appendInbound(elderId, message, externalId = null) {
      return repo.insert(elderId, stripImages(message), clock.now().toISOString(), externalId);
    },
    append(elderId, messages) {
      repo.insertMany(elderId, messages.map(stripImages), clock.now().toISOString());
    },
    window(elderId) {
      const recent = repo.recent(elderId, HISTORY_LIMIT);
      const start = recent.findIndex((message) => message.role === "user");
      return start === -1 ? [] : recent.slice(start);
    },
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/api/src/modules/elders apps/api/src/modules/conversation && npm run typecheck -w @careguard/api`
Expected: 9 tests PASS; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/elders apps/api/src/modules/conversation
git commit -m "feat(api): elders and conversation history modules"
```

---

### Task 5: Events module

**Files:**
- Create: `apps/api/src/modules/events/repo.ts`, `apps/api/src/modules/events/bus.ts`, `apps/api/src/modules/events/service.ts`
- Test: `apps/api/src/modules/events/service.test.ts`

**Interfaces:**
- Consumes: `EldersService` (Task 4), `Messenger`, `Clock`, `Logger`, `CapturingMessenger`, `ConflictError`, `NotFoundError`.
- Produces:
  - `interface EventBus { publish(message: StreamMessage): void; subscribe(listener: (message: StreamMessage) => void): () => void }`, `createEventBus(): EventBus`
  - `createEventsRepo(db)`
  - `interface RecordEventInput { elderId: string; type: EventType; severity: Severity; summary: string; detail?: Record<string, unknown> }`
  - `REASSURANCE: string`
  - `interface EventsService { record(input: RecordEventInput): CareEvent; list(query?: ListEventsQuery): CareEvent[]; get(id: string): CareEvent; approve(id: string, by?: string | null): Promise<CareEvent>; dismiss(id: string, by?: string | null): CareEvent }`
  - `createEventsService({ repo, bus, messenger, elders, clock, log }): EventsService`

- [ ] **Step 1: Write the failing test**

`apps/api/src/modules/events/service.test.ts`:
```ts
import type { StreamMessage } from "@careguard/shared";
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { ConflictError, NotFoundError } from "../../errors.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "./bus.js";
import { createEventsRepo } from "./repo.js";
import { createEventsService, REASSURANCE } from "./service.js";

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const messenger = new CapturingMessenger();
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const bus = createEventBus();
  const published: StreamMessage[] = [];
  bus.subscribe((message) => published.push(message));
  const events = createEventsService({ repo: createEventsRepo(db), bus, messenger, elders, clock, log: silentLogger });
  const mak = elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  const tok = elders.findOrCreateByPhone("whatsapp:+60199999999", "Tok");
  return { clock, messenger, events, published, mak, tok };
}

const scam = (elderId: string) => ({
  elderId,
  type: "scam_detected" as const,
  severity: "high" as const,
  summary: "Likely scam",
  detail: { reasons: ["asks for TAC"] },
});

describe("EventsService", () => {
  it("records an event, persists it, and publishes event.created", () => {
    const { events, published, mak } = setup();
    const event = events.record(scam(mak.id));

    expect(event).toMatchObject({
      elderId: mak.id,
      type: "scam_detected",
      severity: "high",
      status: "new",
      detail: { reasons: ["asks for TAC"] },
      createdAt: "2026-09-13T03:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(event.id).toMatch(/^evt_/);
    expect(events.get(event.id)).toEqual(event);
    expect(published).toEqual([{ type: "event.created", event }]);
  });

  it("defaults detail to an empty object", () => {
    const { events, mak } = setup();
    const event = events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });
    expect(events.get(event.id).detail).toEqual({});
  });

  it("lists newest first and applies every filter", () => {
    const { events, clock, mak, tok } = setup();
    const first = events.record(scam(mak.id));
    clock.set("2026-09-13T04:00:00.000Z");
    const second = events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });
    clock.set("2026-09-13T05:00:00.000Z");
    const third = events.record(scam(tok.id));

    expect(events.list().map((e) => e.id)).toEqual([third.id, second.id, first.id]);
    expect(events.list({ elderId: mak.id }).map((e) => e.id)).toEqual([second.id, first.id]);
    expect(events.list({ severity: "high" }).map((e) => e.id)).toEqual([third.id, first.id]);
    expect(events.list({ since: "2026-09-13T03:30:00.000Z" }).map((e) => e.id)).toEqual([third.id, second.id]);
    events.dismiss(first.id);
    expect(events.list({ status: "new" }).map((e) => e.id)).toEqual([third.id, second.id]);
  });

  it("approving a scam event reassures the elder exactly once", async () => {
    const { events, messenger, published, clock, mak } = setup();
    const event = events.record(scam(mak.id));
    clock.set("2026-09-13T03:05:00.000Z");

    const approved = await events.approve(event.id);

    expect(approved).toMatchObject({ status: "approved", resolvedAt: "2026-09-13T03:05:00.000Z", resolvedBy: null });
    expect(messenger.sent).toEqual([{ to: mak.phone, body: REASSURANCE }]);
    expect(published.at(-1)).toEqual({ type: "event.updated", event: approved });

    await expect(events.approve(event.id)).rejects.toThrow(ConflictError);
    expect(messenger.sent).toHaveLength(1);
  });

  it("approving a low-severity event does not message the elder", async () => {
    const { events, messenger, mak } = setup();
    const event = events.record({ elderId: mak.id, type: "bill_explained", severity: "low", summary: "TNB bill" });
    await events.approve(event.id);
    expect(messenger.sent).toEqual([]);
  });

  it("dismisses without messaging and rejects a second decision", async () => {
    const { events, messenger, mak } = setup();
    const event = events.record(scam(mak.id));
    expect(events.dismiss(event.id).status).toBe("dismissed");
    expect(messenger.sent).toEqual([]);
    await expect(events.approve(event.id)).rejects.toThrow(ConflictError);
  });

  it("throws NotFoundError for unknown ids", async () => {
    const { events } = setup();
    expect(() => events.get("evt_missing")).toThrow(NotFoundError);
    expect(() => events.dismiss("evt_missing")).toThrow(NotFoundError);
    await expect(events.approve("evt_missing")).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/api/src/modules/events`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the bus and repo**

`apps/api/src/modules/events/bus.ts`:
```ts
import type { StreamMessage } from "@careguard/shared";
import { EventEmitter } from "node:events";

export interface EventBus {
  publish(message: StreamMessage): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: StreamMessage) => void): () => void;
}

export function createEventBus(): EventBus {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // one listener per open dashboard stream
  return {
    publish: (message) => {
      emitter.emit("message", message);
    },
    subscribe(listener) {
      emitter.on("message", listener);
      return () => emitter.off("message", listener);
    },
  };
}
```

`apps/api/src/modules/events/repo.ts`:
```ts
import type { CareEvent, EventStatus, EventType, ListEventsQuery, Severity } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface EventRow {
  id: string;
  elder_id: string;
  type: string;
  severity: string;
  summary: string;
  detail: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const toEvent = (r: EventRow): CareEvent => ({
  id: r.id,
  elderId: r.elder_id,
  type: r.type as EventType,
  severity: r.severity as Severity,
  summary: r.summary,
  detail: JSON.parse(r.detail) as Record<string, unknown>,
  status: r.status as EventStatus,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  resolvedBy: r.resolved_by,
});

export function createEventsRepo(db: Db) {
  return {
    insert(event: CareEvent): void {
      db.prepare(
        `INSERT INTO events (id, elder_id, type, severity, summary, detail, status, created_at, resolved_at, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id,
        event.elderId,
        event.type,
        event.severity,
        event.summary,
        JSON.stringify(event.detail),
        event.status,
        event.createdAt,
        event.resolvedAt,
        event.resolvedBy,
      );
    },
    get(id: string): CareEvent | undefined {
      const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
      return row && toEvent(row);
    },
    list(query: ListEventsQuery): CareEvent[] {
      const where: string[] = [];
      const params: string[] = [];
      if (query.elderId) { where.push("elder_id = ?"); params.push(query.elderId); }
      if (query.status) { where.push("status = ?"); params.push(query.status); }
      if (query.severity) { where.push("severity = ?"); params.push(query.severity); }
      if (query.since) { where.push("created_at >= ?"); params.push(query.since); }
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = db
        .prepare(`SELECT * FROM events ${clause} ORDER BY created_at DESC, rowid DESC LIMIT 200`)
        .all(...params) as EventRow[];
      return rows.map(toEvent);
    },
    /** Moves a `new` event to a decided status. Returns false if it was not `new`. */
    decide(id: string, status: "approved" | "dismissed", resolvedAt: string, resolvedBy: string | null): boolean {
      return (
        db
          .prepare("UPDATE events SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'new'")
          .run(status, resolvedAt, resolvedBy, id).changes === 1
      );
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
```

- [ ] **Step 4: Implement the service**

`apps/api/src/modules/events/service.ts`:
```ts
import type { CareEvent, EventType, ListEventsQuery, Severity } from "@careguard/shared";
import { ConflictError, NotFoundError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { EldersService } from "../elders/service.js";
import type { EventBus } from "./bus.js";
import type { EventsRepo } from "./repo.js";

export interface RecordEventInput {
  elderId: string;
  type: EventType;
  severity: Severity;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface EventsService {
  record(input: RecordEventInput): CareEvent;
  list(query?: ListEventsQuery): CareEvent[];
  get(id: string): CareEvent;
  approve(id: string, by?: string | null): Promise<CareEvent>;
  dismiss(id: string, by?: string | null): CareEvent;
}

/** Sent to the elder when family approves a high-risk event. Wording is tuned on event day. */
export const REASSURANCE =
  "Anak awak dah tengok amaran tadi dan setuju — awak selamat. Jangan klik apa-apa link atau beri OTP ya. 💙\n\n" +
  "Your family has seen the warning and agrees — you're safe. Please don't click any link or share any OTP. 💙";

const REASSURE_ON: ReadonlySet<EventType> = new Set(["scam_detected", "high_risk_action"]);

export interface EventsDeps {
  repo: EventsRepo;
  bus: EventBus;
  messenger: Messenger;
  elders: EldersService;
  clock: Clock;
  log: Logger;
}

export function createEventsService({ repo, bus, messenger, elders, clock, log }: EventsDeps): EventsService {
  function get(id: string): CareEvent {
    const event = repo.get(id);
    if (!event) throw new NotFoundError(`Event ${id} not found`);
    return event;
  }

  function decide(id: string, status: "approved" | "dismissed", by: string | null): CareEvent {
    const current = get(id);
    if (!repo.decide(id, status, clock.now().toISOString(), by)) {
      throw new ConflictError(`Event ${id} is already ${current.status}`);
    }
    const updated = get(id);
    bus.publish({ type: "event.updated", event: updated });
    return updated;
  }

  return {
    record(input) {
      const event: CareEvent = {
        id: newId("evt"),
        elderId: input.elderId,
        type: input.type,
        severity: input.severity,
        summary: input.summary,
        detail: input.detail ?? {},
        status: "new",
        createdAt: clock.now().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
      };
      repo.insert(event);
      bus.publish({ type: "event.created", event });
      return event;
    },
    list: (query = {}) => repo.list(query),
    get,
    async approve(id, by = null) {
      const approved = decide(id, "approved", by);
      if (REASSURE_ON.has(approved.type)) {
        const elder = elders.get(approved.elderId);
        const delivered = await messenger.send({ to: elder.phone, body: REASSURANCE });
        if (!delivered) log.warn("reassurance not delivered", { eventId: id, elderId: elder.id });
      }
      return approved;
    },
    dismiss: (id, by = null) => decide(id, "dismissed", by),
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/api/src/modules/events && npm run typecheck -w @careguard/api`
Expected: 7 tests PASS; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/events
git commit -m "feat(api): events store with bus, filters, and one-shot approval reassurance"
```

---

### Task 6: Family, reminders and understand modules (with their tools)

**Files:**
- Create: `apps/api/src/modules/family/{repo,service,tools}.ts`, `apps/api/src/modules/reminders/{repo,service,tools}.ts`, `apps/api/src/modules/understand/{service,tools}.ts`
- Test: `apps/api/src/modules/family/family.test.ts`, `apps/api/src/modules/reminders/reminders.test.ts`, `apps/api/src/modules/understand/understand.test.ts`

**Interfaces:**
- Consumes: `EldersService` (Task 4), `EventsService`, `createEventBus`, `createEventsRepo` (Task 5), `defineTool`, `ToolSet`, `ToolContext`, `normalizePhone`, `createInProcessScheduler`, `CapturingMessenger`, fakes (Task 3), `ValidationError`.
- Produces:
  - `interface FamilyService { register(elderId: string, input: { phone: string; name?: string | null }): FamilyMember; list(elderId: string): FamilyMember[]; notify(elder: Elder, summary: string, messenger: Messenger): Promise<{ delivered: number; total: number }> }`, `createFamilyRepo(db)`, `createFamilyService({ repo, clock, log })`, `createFamilyTools(family): ToolSet` → `register_family`, `notify_family`
  - `interface CreateReminderInput { what: string; dueText: string; dueAt?: string | null }`, `interface RemindersService { create(elder: Elder, input: CreateReminderInput): Reminder; list(elderId?: string): Reminder[]; restorePending(): number }`, `nudgeText(reminder: Reminder): string`, `createRemindersRepo(db)`, `createRemindersService({ repo, elders, events, messenger, scheduler, clock, log })`, `createReminderTools(reminders): ToolSet` → `create_reminder`
  - `interface UnderstandService { logDocument(elder: Elder, input: { kind: DocumentKind; summary: string }): CareEvent }`, `createUnderstandService({ events })`, `createUnderstandTools(understand): ToolSet` → `log_document`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/family/family.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { ValidationError } from "../../errors.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createFamilyRepo } from "./repo.js";
import { createFamilyService } from "./service.js";
import { createFamilyTools } from "./tools.js";

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const mak = createEldersService({ repo: createEldersRepo(db), clock }).findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  const family = createFamilyService({ repo: createFamilyRepo(db), clock, log: silentLogger });
  return { mak, family, tools: createFamilyTools(family) };
}

describe("FamilyService", () => {
  it("registers a family member with a normalised number", () => {
    const { mak, family } = setup();
    const member = family.register(mak.id, { phone: "012-345 6789", name: "Aisyah" });
    expect(member).toMatchObject({ elderId: mak.id, phone: "+60123456789", name: "Aisyah" });
    expect(member.id).toMatch(/^fam_/);
  });

  it("updates rather than duplicates the same number, keeping a known name", () => {
    const { mak, family } = setup();
    const first = family.register(mak.id, { phone: "0123456789", name: "Aisyah" });
    const again = family.register(mak.id, { phone: "+60123456789" });
    expect(again).toEqual(first);
    expect(family.list(mak.id)).toHaveLength(1);
  });

  it("rejects an invalid number", () => {
    const { mak, family } = setup();
    expect(() => family.register(mak.id, { phone: "123" })).toThrow(ValidationError);
  });

  it("notifies every family member through the given messenger", async () => {
    const { mak, family } = setup();
    family.register(mak.id, { phone: "0123456789", name: "Aisyah" });
    family.register(mak.id, { phone: "0198765432", name: "Hafiz" });
    const messenger = new CapturingMessenger();

    await expect(family.notify(mak, "fake Maybank SMS", messenger)).resolves.toEqual({ delivered: 2, total: 2 });
    expect(messenger.sent.map((m) => m.to)).toEqual(["+60123456789", "+60198765432"]);
    expect(messenger.sent[0]!.body).toContain("Mak just received a likely scam (fake Maybank SMS)");
  });

  it("reports failed deliveries and the no-family case", async () => {
    const { mak, family } = setup();
    await expect(family.notify(mak, "x", new CapturingMessenger())).resolves.toEqual({ delivered: 0, total: 0 });
    family.register(mak.id, { phone: "0123456789" });
    await expect(family.notify(mak, "x", new CapturingMessenger(false))).resolves.toEqual({ delivered: 0, total: 1 });
  });
});

describe("family tools", () => {
  it("register_family returns guidance for an invalid number", async () => {
    const { mak, tools } = setup();
    const result = await tools.register_family!.run({ phone: "123" }, testContext({ elder: mak }));
    expect(result).toContain("012-3456789");
  });

  it("notify_family asks for a number when none is saved, then alerts", async () => {
    const { mak, tools } = setup();
    const messenger = new CapturingMessenger();
    const ctx = testContext({ elder: mak, messenger });

    await expect(tools.notify_family!.run({ summary: "fake parcel SMS" }, ctx)).resolves.toContain("No family number saved yet");
    await tools.register_family!.run({ phone: "0123456789", name: "Aisyah" }, ctx);
    await expect(tools.notify_family!.run({ summary: "fake parcel SMS" }, ctx)).resolves.toBe("Alerted 1 of 1 family member(s).");
    expect(messenger.sent).toHaveLength(1);
  });

  it("notify_family is honest when delivery fails", async () => {
    const { mak, tools, family } = setup();
    family.register(mak.id, { phone: "0123456789" });
    const ctx = testContext({ elder: mak, messenger: new CapturingMessenger(false) });
    await expect(tools.notify_family!.run({ summary: "x" }, ctx)).resolves.toContain("could not be delivered");
  });
});
```

`apps/api/src/modules/reminders/reminders.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { createInProcessScheduler } from "../../adapters/in-process-scheduler.js";
import { ValidationError } from "../../errors.js";
import type { Db } from "../../infra/db.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "../events/bus.js";
import { createEventsRepo } from "../events/repo.js";
import { createEventsService } from "../events/service.js";
import { createRemindersRepo } from "./repo.js";
import { createRemindersService } from "./service.js";
import { createReminderTools } from "./tools.js";

function build(db: Db) {
  const clock = fixedClock("2026-09-13T03:00:00.000Z");
  const messenger = new CapturingMessenger();
  const scheduler = createInProcessScheduler(clock, silentLogger);
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const events = createEventsService({ repo: createEventsRepo(db), bus: createEventBus(), messenger, elders, clock, log: silentLogger });
  const reminders = createRemindersService({ repo: createRemindersRepo(db), elders, events, messenger, scheduler, clock, log: silentLogger });
  const mak = elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  return { clock, messenger, scheduler, events, reminders, mak, tools: createReminderTools(reminders) };
}

describe("RemindersService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a reminder without a time, records an event, and schedules nothing", () => {
    const { reminders, scheduler, events, mak } = build(createTestDb());
    const reminder = reminders.create(mak, { what: "Pay TNB bill RM143", dueText: "before 25 September" });

    expect(reminder).toMatchObject({ elderId: mak.id, dueAt: null, status: "scheduled" });
    expect(scheduler.size()).toBe(0);
    expect(events.list({ elderId: mak.id })).toMatchObject([
      { type: "reminder_created", severity: "low", summary: "Reminder set: Pay TNB bill RM143 — before 25 September" },
    ]);
  });

  it("sends a WhatsApp nudge when a timed reminder is due", async () => {
    const { reminders, messenger, mak } = build(createTestDb());
    const reminder = reminders.create(mak, { what: "Pay TNB bill RM143", dueText: "in one hour", dueAt: "2026-09-13T12:00:00+08:00" });
    expect(reminder.dueAt).toBe("2026-09-13T04:00:00.000Z");

    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(messenger.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(messenger.sent).toHaveLength(1);
    expect(messenger.sent[0]).toMatchObject({ to: mak.phone });
    expect(messenger.sent[0]!.body).toContain("Pay TNB bill RM143");
    expect(reminders.list(mak.id)[0]!.status).toBe("sent");
  });

  it("does not schedule a reminder whose time has already passed", () => {
    const { reminders, scheduler, mak } = build(createTestDb());
    reminders.create(mak, { what: "x", dueText: "yesterday", dueAt: "2026-09-12T09:00:00+08:00" });
    expect(scheduler.size()).toBe(0);
  });

  it("rejects a dueAt that is not an ISO date-time", () => {
    const { reminders, mak } = build(createTestDb());
    expect(() => reminders.create(mak, { what: "x", dueText: "soon", dueAt: "25 September" })).toThrow(ValidationError);
  });

  it("reschedules pending reminders after a restart", async () => {
    const db = createTestDb();
    const before = build(db);
    before.reminders.create(before.mak, { what: "Klinik appointment", dueText: "at noon", dueAt: "2026-09-13T12:00:00+08:00" });
    before.scheduler.cancel(before.reminders.list()[0]!.id); // simulate the process dying

    const after = build(db);
    expect(after.reminders.restorePending()).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(after.messenger.sent).toHaveLength(1);
  });

  it("create_reminder tool reports the outcome to the model", async () => {
    const { tools, mak } = build(createTestDb());
    const ctx = testContext({ elder: mak });
    await expect(tools.create_reminder!.run({ what: "Pay bill", dueText: "at noon", dueAt: "2026-09-13T12:00:00+08:00" }, ctx)).resolves.toBe(
      "Reminder set for at noon. I'll send a WhatsApp nudge then.",
    );
    await expect(tools.create_reminder!.run({ what: "Pay bill", dueText: "next week" }, ctx)).resolves.toBe(
      'Reminder saved: "Pay bill" — next week.',
    );
    await expect(tools.create_reminder!.run({ what: "Pay bill", dueText: "soon", dueAt: "soon" }, ctx)).resolves.toContain(
      "Could not set that time",
    );
  });
});
```

Note: `build(db)` called twice on the same db creates `Mak` once (find-or-create) — both builds see the same elder.

`apps/api/src/modules/understand/understand.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { createTestDb } from "../../test/db.js";
import { fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "../events/bus.js";
import { createEventsRepo } from "../events/repo.js";
import { createEventsService } from "../events/service.js";
import { createUnderstandService } from "./service.js";
import { createUnderstandTools } from "./tools.js";

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const events = createEventsService({
    repo: createEventsRepo(db),
    bus: createEventBus(),
    messenger: new CapturingMessenger(),
    elders,
    clock,
    log: silentLogger,
  });
  const understand = createUnderstandService({ events });
  return { events, understand, tools: createUnderstandTools(understand), mak: elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak") };
}

describe("understand", () => {
  it("logs an explained document as a low bill_explained event", () => {
    const { understand, mak } = setup();
    expect(understand.logDocument(mak, { kind: "letter", summary: "LHDN tax letter — reply by 30 Sep" })).toMatchObject({
      elderId: mak.id,
      type: "bill_explained",
      severity: "low",
      summary: "LHDN tax letter — reply by 30 Sep",
      detail: { kind: "letter" },
    });
  });

  it("log_document tool records the event for the current elder", async () => {
    const { tools, events, mak } = setup();
    await expect(
      tools.log_document!.run({ kind: "bill", summary: "TNB electricity bill — RM143, due 25 Sep" }, testContext({ elder: mak })),
    ).resolves.toBe("Logged for the family timeline.");
    expect(events.list({ elderId: mak.id })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/api/src/modules/family apps/api/src/modules/reminders apps/api/src/modules/understand`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the family module**

`apps/api/src/modules/family/repo.ts`:
```ts
import type { FamilyMember } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface FamilyRow {
  id: string;
  elder_id: string;
  name: string | null;
  phone: string;
  created_at: string;
}

const toMember = (r: FamilyRow): FamilyMember => ({
  id: r.id,
  elderId: r.elder_id,
  name: r.name,
  phone: r.phone,
  createdAt: r.created_at,
});

export function createFamilyRepo(db: Db) {
  function find(elderId: string, phone: string): FamilyMember | undefined {
    const row = db.prepare("SELECT * FROM family_members WHERE elder_id = ? AND phone = ?").get(elderId, phone) as
      | FamilyRow
      | undefined;
    return row && toMember(row);
  }

  return {
    /** Inserts, or keeps the existing row for this (elder, phone) and fills in a missing name. */
    upsert(member: FamilyMember): FamilyMember {
      db.prepare(
        `INSERT INTO family_members (id, elder_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (elder_id, phone) DO UPDATE SET name = COALESCE(excluded.name, family_members.name)`,
      ).run(member.id, member.elderId, member.name, member.phone, member.createdAt);
      return find(member.elderId, member.phone)!;
    },
    listByElder(elderId: string): FamilyMember[] {
      return (
        db.prepare("SELECT * FROM family_members WHERE elder_id = ? ORDER BY created_at, rowid").all(elderId) as FamilyRow[]
      ).map(toMember);
    },
  };
}

export type FamilyRepo = ReturnType<typeof createFamilyRepo>;
```

`apps/api/src/modules/family/service.ts`:
```ts
import type { Elder, FamilyMember } from "@careguard/shared";
import { ValidationError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import { normalizePhone } from "../../phone.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { FamilyRepo } from "./repo.js";

export interface FamilyService {
  register(elderId: string, input: { phone: string; name?: string | null }): FamilyMember;
  list(elderId: string): FamilyMember[];
  /** The messenger is per turn, so simulated turns capture alerts instead of sending them. */
  notify(elder: Elder, summary: string, messenger: Messenger): Promise<{ delivered: number; total: number }>;
}

export function createFamilyService({ repo, clock, log }: { repo: FamilyRepo; clock: Clock; log: Logger }): FamilyService {
  return {
    register(elderId, { phone, name = null }) {
      const normalized = normalizePhone(phone);
      if (!normalized) throw new ValidationError(`"${phone}" is not a valid phone number.`);
      return repo.upsert({ id: newId("fam"), elderId, name, phone: normalized, createdAt: clock.now().toISOString() });
    },
    list: (elderId) => repo.listByElder(elderId),
    async notify(elder, summary, messenger) {
      const members = repo.listByElder(elder.id);
      if (members.length === 0) return { delivered: 0, total: 0 };

      const who = elder.name ?? "Your family member";
      const body =
        `⚠️ CareGuard alert: ${who} just received a likely scam (${summary}). ` +
        "I've told them not to click anything or share any details. It might be worth a quick call to check in.";
      const results = await Promise.all(members.map((member) => messenger.send({ to: member.phone, body })));
      const delivered = results.filter(Boolean).length;
      if (delivered < members.length) log.warn("family alert partly undelivered", { elderId: elder.id, delivered, total: members.length });
      return { delivered, total: members.length };
    },
  };
}
```

`apps/api/src/modules/family/tools.ts`:
```ts
import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import { ValidationError } from "../../errors.js";
import type { FamilyService } from "./service.js";

export function createFamilyTools(family: FamilyService): ToolSet {
  return {
    register_family: defineTool({
      name: "register_family",
      description:
        "Save a trusted family member's phone number so CareGuard can alert them about scams. " +
        "Call this when the user shares a number, e.g. 'my daughter's number is 012-3456789'.",
      input: z.object({
        phone: z.string().describe("The family member's phone number, e.g. 012-3456789 or +60123456789"),
        name: z.string().optional().describe("Name or relationship, e.g. 'Aisyah (daughter)'"),
      }),
      run: async ({ phone, name }, ctx) => {
        try {
          const member = family.register(ctx.elder.id, { phone, name });
          return `Saved ${member.name ?? member.phone}. I'll alert ${member.phone} if something risky happens.`;
        } catch (err) {
          if (err instanceof ValidationError) return `${err.message} Ask the user for a number like 012-3456789.`;
          throw err;
        }
      },
    }),

    notify_family: defineTool({
      name: "notify_family",
      description:
        "Alert the user's registered family members that the user received a likely scam. " +
        "Call this after a HIGH-risk verdict, once the user agrees.",
      input: z.object({ summary: z.string().describe("One line on what the scam was, e.g. 'fake Maybank account-blocked SMS'") }),
      run: async ({ summary }, ctx) => {
        const { delivered, total } = await family.notify(ctx.elder, summary, ctx.messenger);
        if (total === 0) return "No family number saved yet — ask the user for one, then call register_family.";
        if (delivered === 0) return "The alert could not be delivered right now. Tell the user honestly and suggest they call their family directly.";
        return `Alerted ${delivered} of ${total} family member(s).`;
      },
    }),
  };
}
```

- [ ] **Step 4: Implement the reminders module**

`apps/api/src/modules/reminders/repo.ts`:
```ts
import type { Reminder, ReminderStatus } from "@careguard/shared";
import type { Db } from "../../infra/db.js";

interface ReminderRow {
  id: string;
  elder_id: string;
  what: string;
  due_text: string;
  due_at: string | null;
  status: string;
  job_id: string | null;
  created_at: string;
}

const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  elderId: r.elder_id,
  what: r.what,
  dueText: r.due_text,
  dueAt: r.due_at,
  status: r.status as ReminderStatus,
  createdAt: r.created_at,
});

export function createRemindersRepo(db: Db) {
  return {
    insert(reminder: Reminder): void {
      db.prepare(
        "INSERT INTO reminders (id, elder_id, what, due_text, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(reminder.id, reminder.elderId, reminder.what, reminder.dueText, reminder.dueAt, reminder.status, reminder.createdAt);
    },
    get(id: string): Reminder | undefined {
      const row = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as ReminderRow | undefined;
      return row && toReminder(row);
    },
    list(elderId?: string): Reminder[] {
      const rows = elderId
        ? db.prepare("SELECT * FROM reminders WHERE elder_id = ? ORDER BY created_at DESC, rowid DESC").all(elderId)
        : db.prepare("SELECT * FROM reminders ORDER BY created_at DESC, rowid DESC").all();
      return (rows as ReminderRow[]).map(toReminder);
    },
    listScheduledWithDueAt(): Reminder[] {
      return (
        db.prepare("SELECT * FROM reminders WHERE status = 'scheduled' AND due_at IS NOT NULL").all() as ReminderRow[]
      ).map(toReminder);
    },
    setJobId(id: string, jobId: string): void {
      db.prepare("UPDATE reminders SET job_id = ? WHERE id = ?").run(jobId, id);
    },
    markSent(id: string): void {
      db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(id);
    },
  };
}

export type RemindersRepo = ReturnType<typeof createRemindersRepo>;
```

`apps/api/src/modules/reminders/service.ts`:
```ts
import type { Elder, Reminder } from "@careguard/shared";
import { ValidationError } from "../../errors.js";
import { newId } from "../../infra/ids.js";
import type { Clock } from "../../ports/clock.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import type { Scheduler } from "../../ports/scheduler.js";
import type { EldersService } from "../elders/service.js";
import type { EventsService } from "../events/service.js";
import type { RemindersRepo } from "./repo.js";

export interface CreateReminderInput {
  what: string;
  dueText: string;
  /** ISO-8601 with a timezone, e.g. 2026-09-24T09:00:00+08:00. */
  dueAt?: string | null;
}

export interface RemindersService {
  create(elder: Elder, input: CreateReminderInput): Reminder;
  list(elderId?: string): Reminder[];
  /** Re-registers scheduled reminders after a restart. Returns how many. */
  restorePending(): number;
}

export interface RemindersDeps {
  repo: RemindersRepo;
  elders: EldersService;
  events: EventsService;
  messenger: Messenger;
  scheduler: Scheduler;
  clock: Clock;
  log: Logger;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function nudgeText(reminder: Reminder): string {
  return `⏰ Peringatan: ${reminder.what} (${reminder.dueText}).\nReminder: ${reminder.what} (${reminder.dueText}).`;
}

export function createRemindersService({ repo, elders, events, messenger, scheduler, clock, log }: RemindersDeps): RemindersService {
  async function nudge(id: string): Promise<void> {
    const reminder = repo.get(id);
    if (!reminder || reminder.status !== "scheduled") return;
    const elder = elders.get(reminder.elderId);
    if (await messenger.send({ to: elder.phone, body: nudgeText(reminder) })) repo.markSent(id);
    else log.warn("reminder nudge not delivered", { reminderId: id });
  }

  function schedule(reminder: Reminder & { dueAt: string }): void {
    const jobId = scheduler.schedule({ id: reminder.id, runAt: new Date(reminder.dueAt), run: () => nudge(reminder.id) });
    repo.setJobId(reminder.id, jobId);
  }

  function parseDueAt(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const time = Date.parse(raw);
    if (!ISO_DATE_TIME.test(raw) || Number.isNaN(time)) throw new ValidationError(`"${raw}" is not an ISO-8601 date-time.`);
    return new Date(time).toISOString();
  }

  return {
    create(elder, input) {
      const reminder: Reminder = {
        id: newId("rem"),
        elderId: elder.id,
        what: input.what,
        dueText: input.dueText,
        dueAt: parseDueAt(input.dueAt),
        status: "scheduled",
        createdAt: clock.now().toISOString(),
      };
      repo.insert(reminder);
      if (reminder.dueAt && Date.parse(reminder.dueAt) > clock.now().getTime()) {
        schedule({ ...reminder, dueAt: reminder.dueAt });
      }
      events.record({
        elderId: elder.id,
        type: "reminder_created",
        severity: "low",
        summary: `Reminder set: ${input.what} — ${input.dueText}`,
        detail: { reminderId: reminder.id, dueAt: reminder.dueAt },
      });
      return reminder;
    },
    list: (elderId) => repo.list(elderId),
    restorePending() {
      const pending = repo.listScheduledWithDueAt();
      for (const reminder of pending) schedule({ ...reminder, dueAt: reminder.dueAt! });
      return pending.length;
    },
  };
}
```

`apps/api/src/modules/reminders/tools.ts`:
```ts
import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import { ValidationError } from "../../errors.js";
import type { RemindersService } from "./service.js";

export function createReminderTools(reminders: RemindersService): ToolSet {
  return {
    create_reminder: defineTool({
      name: "create_reminder",
      description:
        "Create a simple reminder for the user, e.g. to pay a bill or attend an appointment. " +
        "Low-risk, so just do it and confirm warmly. Call this after explaining a bill or letter when the user agrees.",
      input: z.object({
        what: z.string().describe("What to remind them about, e.g. 'Pay TNB electricity bill RM143'"),
        dueText: z.string().describe("When, in the user's own words, e.g. 'before 25 September'"),
        dueAt: z
          .string()
          .optional()
          .describe("Exact reminder time as ISO-8601 with +08:00, e.g. 2026-09-24T09:00:00+08:00. Omit if unclear."),
      }),
      run: async (input, ctx) => {
        try {
          const reminder = reminders.create(ctx.elder, input);
          return reminder.dueAt
            ? `Reminder set for ${reminder.dueText}. I'll send a WhatsApp nudge then.`
            : `Reminder saved: "${reminder.what}" — ${reminder.dueText}.`;
        } catch (err) {
          if (err instanceof ValidationError) return `Could not set that time: ${err.message} Retry with a valid dueAt, or omit it.`;
          throw err;
        }
      },
    }),
  };
}
```

- [ ] **Step 5: Implement the understand module**

`apps/api/src/modules/understand/service.ts`:
```ts
import type { CareEvent, DocumentKind, Elder } from "@careguard/shared";
import type { EventsService } from "../events/service.js";

export interface UnderstandService {
  logDocument(elder: Elder, input: { kind: DocumentKind; summary: string }): CareEvent;
}

export function createUnderstandService({ events }: { events: EventsService }): UnderstandService {
  return {
    logDocument: (elder, { kind, summary }) =>
      events.record({ elderId: elder.id, type: "bill_explained", severity: "low", summary, detail: { kind } }),
  };
}
```

`apps/api/src/modules/understand/tools.ts`:
```ts
import { DocumentKind } from "@careguard/shared";
import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import type { UnderstandService } from "./service.js";

export function createUnderstandTools(understand: UnderstandService): ToolSet {
  return {
    log_document: defineTool({
      name: "log_document",
      description:
        "Record that you explained a bill, letter or appointment to the user, so their family sees it on their timeline. " +
        "Call once after explaining a document.",
      input: z.object({
        kind: DocumentKind.describe("What kind of document it was"),
        summary: z.string().describe("One line, e.g. 'TNB electricity bill — RM143, due 25 Sep'"),
      }),
      run: async (input, ctx) => {
        understand.logDocument(ctx.elder, input);
        return "Logged for the family timeline.";
      },
    }),
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/api/src/modules/family apps/api/src/modules/reminders apps/api/src/modules/understand && npm run typecheck -w @careguard/api`
Expected: 16 tests PASS; `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/family apps/api/src/modules/reminders apps/api/src/modules/understand
git commit -m "feat(api): family alerts, scheduled reminders, and document logging with tools"
```

---

### Task 7: Protect module (scam investigation)

**Files:**
- Create: `apps/api/src/modules/protect/{patterns,urlcheck,service,verdict,tools}.ts`
- Test: `apps/api/src/modules/protect/urlcheck.test.ts`, `apps/api/src/modules/protect/protect.test.ts`

**Interfaces:**
- Consumes: `Search`, `UrlReputation` (Task 3), `EventsService` (Task 5), `defineTool`, fakes, test builders from Tasks 4–5.
- Produces:
  - `PATTERNS: { re: RegExp; why: string }[]`
  - `interface UrlFinding { url: string; host: string; flags: string[]; suspicious: boolean }`, `checkUrl(rawUrl: string, messageText: string, reputation: UrlReputation): Promise<UrlFinding>`
  - `type Risk = "HIGH" | "MEDIUM" | "LOW"`, `interface InvestigationInput { text: string; urls?: string[]; phones?: string[]; senderClaim?: string }`, `interface Investigation { risk: Risk; reasons: string[]; webNote: string | null }`, `interface ProtectService { investigate(input: InvestigationInput): Promise<Investigation> }`, `createProtectService({ search, urlReputation }): ProtectService`
  - `renderVerdict(investigation: Investigation): string`
  - `createProtectTools(protect, events): ToolSet` → `investigate_message`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/protect/urlcheck.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { offlineUrlReputation } from "../../adapters/offline-url-reputation.js";
import { fakeUrlReputation } from "../../test/fakes.js";
import { checkUrl } from "./urlcheck.js";

describe("checkUrl", () => {
  it("flags a link that name-drops a Malaysian bank but is not its domain", async () => {
    const finding = await checkUrl("http://maybank-verify.xyz/login", "Maybank: sila log masuk", offlineUrlReputation);
    expect(finding.suspicious).toBe(true);
    expect(finding.host).toBe("maybank-verify.xyz");
    expect(finding.flags).toContain('Mentions "maybank" but the link is maybank-verify.xyz, not an official maybank domain');
  });

  it("accepts the bank's official domain, including subdomains", async () => {
    const finding = await checkUrl("https://www.maybank2u.com.my/home", "Maybank: your statement is ready", offlineUrlReputation);
    expect(finding).toMatchObject({ host: "maybank2u.com.my", flags: [], suspicious: false });
  });

  it("parses bare domains without a scheme", async () => {
    const finding = await checkUrl("cimb-rewards.top", "CIMB hadiah menanti", offlineUrlReputation);
    expect(finding.host).toBe("cimb-rewards.top");
    expect(finding.suspicious).toBe(true);
  });

  it("matches brands as whole words — 'deposit' is not Pos Malaysia", async () => {
    const finding = await checkUrl("https://example.com/pay", "Please deposit RM50 today", offlineUrlReputation);
    expect(finding.flags).toEqual([]);
  });

  it.each([
    ["https://bit.ly/3abcd", "Uses a link shortener (hides the real destination)"],
    ["http://192.168.10.5/login", "Links to a raw IP address, not a domain"],
    ["http://xn--80ak6aa92e.com", "Uses punycode (can disguise a fake domain)"],
  ])("flags structural red flags in %s", async (url, flag) => {
    const finding = await checkUrl(url, "", offlineUrlReputation);
    expect(finding.flags).toContain(flag);
  });

  it("adds the Safe Browsing verdict when known unsafe", async () => {
    const finding = await checkUrl("https://evil.example", "", fakeUrlReputation(["https://evil.example"]));
    expect(finding.flags).toEqual(["Flagged by Google Safe Browsing as unsafe"]);
  });

  it("treats an unparseable link as suspicious", async () => {
    const finding = await checkUrl("not a url", "", offlineUrlReputation);
    expect(finding).toMatchObject({ suspicious: true, flags: ["Not a valid URL"] });
  });
});
```

`apps/api/src/modules/protect/protect.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../../adapters/capturing-messenger.js";
import { createTestDb } from "../../test/db.js";
import { fakeSearch, fakeUrlReputation, fixedClock, silentLogger, testContext } from "../../test/fakes.js";
import { createEldersRepo } from "../elders/repo.js";
import { createEldersService } from "../elders/service.js";
import { createEventBus } from "../events/bus.js";
import { createEventsRepo } from "../events/repo.js";
import { createEventsService } from "../events/service.js";
import { createProtectService } from "./service.js";
import { createProtectTools } from "./tools.js";
import { renderVerdict } from "./verdict.js";

const MALAY_BANK_SCAM = "Akaun Maybank anda telah disekat. Sila sahkan segera di maybank-verify.xyz";

describe("ProtectService.investigate", () => {
  const protect = createProtectService({ search: fakeSearch(), urlReputation: fakeUrlReputation() });

  it("rates a Malay bank phishing message HIGH with reasons", async () => {
    const result = await protect.investigate({ text: MALAY_BANK_SCAM, urls: ["maybank-verify.xyz"], senderClaim: "Maybank" });
    expect(result.risk).toBe("HIGH");
    expect(result.reasons[0]).toBe("Threatens to block/suspend your account (fake urgency)");
    expect(result.reasons).toContain('Link maybank-verify.xyz: Mentions "maybank" but the link is maybank-verify.xyz, not an official maybank domain');
  });

  it("rates two scam patterns without links HIGH", async () => {
    const result = await protect.investigate({ text: "Your bank account will be blocked. Reply with your OTP" });
    expect(result.risk).toBe("HIGH");
  });

  it("rates a single pattern MEDIUM", async () => {
    await expect(protect.investigate({ text: "Your parcel is arriving tomorrow" })).resolves.toMatchObject({ risk: "MEDIUM" });
  });

  it("rates an ordinary family message LOW", async () => {
    await expect(protect.investigate({ text: "Jom makan malam Ahad ni, mak masak rendang" })).resolves.toEqual({
      risk: "LOW",
      reasons: [],
      webNote: null,
    });
  });

  it("corroborates on the web, searching the phone number first", async () => {
    const search = fakeSearch([{ title: "Scam alert 012-3456789", url: "https://reports.example/1" }]);
    const withSearch = createProtectService({ search, urlReputation: fakeUrlReputation() });
    const result = await withSearch.investigate({ text: "Call me", phones: ["012-3456789"], urls: ["https://x.example"] });
    expect(search.queries).toEqual(["012-3456789 scam report Malaysia"]);
    expect(result.webNote).toBe("Scam alert 012-3456789 — https://reports.example/1");
  });
});

describe("renderVerdict", () => {
  it("leads with the verdict and safety advice", () => {
    const high = renderVerdict({ risk: "HIGH", reasons: ["Asks for an OTP"], webNote: null });
    expect(high.startsWith("🔴 LIKELY A SCAM")).toBe(true);
    expect(high).toContain("• Asks for an OTP");
    expect(high).toContain("Do NOT click any link");
    expect(renderVerdict({ risk: "LOW", reasons: [], webNote: null }).startsWith("🟢")).toBe(true);
  });
});

describe("investigate_message tool", () => {
  function setup() {
    const db = createTestDb();
    const clock = fixedClock();
    const elders = createEldersService({ repo: createEldersRepo(db), clock });
    const events = createEventsService({ repo: createEventsRepo(db), bus: createEventBus(), messenger: new CapturingMessenger(), elders, clock, log: silentLogger });
    const tools = createProtectTools(createProtectService({ search: fakeSearch(), urlReputation: fakeUrlReputation() }), events);
    return { events, tools, mak: elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak") };
  }

  it("records a scam_detected event for the current elder on HIGH", async () => {
    const { events, tools, mak } = setup();
    const verdict = await tools.investigate_message!.run(
      { text: MALAY_BANK_SCAM, urls: ["maybank-verify.xyz"], senderClaim: "Maybank" },
      testContext({ elder: mak }),
    );
    expect(verdict.startsWith("🔴")).toBe(true);
    expect(events.list({ elderId: mak.id })).toMatchObject([
      { type: "scam_detected", severity: "high", detail: { senderClaim: "Maybank", urls: ["maybank-verify.xyz"] } },
    ]);
  });

  it("records nothing for a LOW verdict", async () => {
    const { events, tools, mak } = setup();
    await tools.investigate_message!.run({ text: "Jom makan malam" }, testContext({ elder: mak }));
    expect(events.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/api/src/modules/protect`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement patterns and URL checks**

`apps/api/src/modules/protect/patterns.ts` (copied from the starter's `src/agent/scam/investigate.ts`):
```ts
/** Scam-pattern language (English + common Malay). Presence is not guilt, but hits stack the risk. */
export const PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\b(otp|tac|password|kata laluan|pin)\b/i, why: "Asks for an OTP/TAC/password — real banks never do this" },
  { re: /\b(block|blocked|suspend|disekat|digantung|dibekukan)\b/i, why: "Threatens to block/suspend your account (fake urgency)" },
  { re: /\b(verify|verification|sahkan|pengesahan|update|kemaskini)\b/i, why: "Demands you 'verify' or 'update' details via a link" },
  { re: /\b(urgent|segera|immediately|sekarang juga|dalam \d+ jam)\b/i, why: "Creates urgency to stop you thinking" },
  { re: /\b(parcel|bungkusan|pos|courier|customs|kastam|delivery)\b/i, why: "Parcel/delivery pretext (common Malaysian scam)" },
  { re: /\b(police|polis|pdrm|bank negara|bnm|lhdn|court|mahkamah)\b/i, why: "Impersonates police / a bank / an agency" },
  { re: /\b(prize|menang|hadiah|reward|won|winner|lucky draw)\b/i, why: "Promises a prize/winnings you didn't enter for" },
  { re: /\b(click|klik|tekan link|tap here|log ?masuk di)\b/i, why: "Pushes you to click a link and log in" },
];
```

`apps/api/src/modules/protect/urlcheck.ts`:
```ts
import type { UrlReputation } from "../../ports/url-reputation.js";

/** Official domains legitimate Malaysian bank / agency messages use, with the names that refer to them. */
const OFFICIAL: Record<string, { names: string[]; domains: string[] }> = {
  maybank: { names: ["maybank", "maybank2u"], domains: ["maybank2u.com.my", "maybank.com.my"] },
  cimb: { names: ["cimb", "cimbclicks"], domains: ["cimbclicks.com.my", "cimb.com.my"] },
  publicbank: { names: ["public bank", "publicbank", "pbebank"], domains: ["pbebank.com", "publicbank.com.my"] },
  rhb: { names: ["rhb"], domains: ["rhbgroup.com", "rhb.com.my"] },
  hongleong: { names: ["hong leong", "hongleong"], domains: ["hongleongconnect.my", "hlb.com.my"] },
  bankislam: { names: ["bank islam", "bankislam"], domains: ["bankislam.com", "bankislam.com.my"] },
  bnm: { names: ["bank negara", "bnm"], domains: ["bnm.gov.my"] },
  lhdn: { names: ["lhdn", "hasil"], domains: ["hasil.gov.my"] },
  jpj: { names: ["jpj", "myeg"], domains: ["jpj.gov.my", "myeg.com.my"] },
  pos: { names: ["pos", "poslaju", "pos malaysia"], domains: ["pos.com.my"] },
  tng: { names: ["tng", "touch n go", "touchngo"], domains: ["touchngo.com.my", "tngdigital.com.my"] },
};

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "rebrand.ly", "shorturl.at"];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const BRAND_MATCHERS = Object.entries(OFFICIAL).map(([brand, { names, domains }]) => ({
  brand,
  domains,
  re: new RegExp(`\\b(${names.map(escapeRegExp).join("|")})\\b`, "i"),
}));

export interface UrlFinding {
  url: string;
  host: string;
  flags: string[];
  suspicious: boolean;
}

export async function checkUrl(rawUrl: string, messageText: string, reputation: UrlReputation): Promise<UrlFinding> {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { url: rawUrl, host: rawUrl, flags: ["Not a valid URL"], suspicious: true };
  }

  const flags: string[] = [];
  if (SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) flags.push("Uses a link shortener (hides the real destination)");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push("Links to a raw IP address, not a domain");
  if (host.startsWith("xn--") || host.includes(".xn--")) flags.push("Uses punycode (can disguise a fake domain)");

  const haystack = `${messageText} ${host}`;
  for (const { brand, domains, re } of BRAND_MATCHERS) {
    if (!re.test(haystack)) continue;
    const official = domains.some((d) => host === d || host.endsWith(`.${d}`));
    if (!official) flags.push(`Mentions "${brand}" but the link is ${host}, not an official ${brand} domain`);
  }

  if ((await reputation.isUnsafe(withScheme)) === true) flags.push("Flagged by Google Safe Browsing as unsafe");

  return { url: rawUrl, host, flags, suspicious: flags.length > 0 };
}
```

**Note on the Safe Browsing test:** `checkUrl("https://evil.example", …)` passes `"https://evil.example"` (unchanged, it already has a scheme) to the reputation port, which is what `fakeUrlReputation(["https://evil.example"])` matches.

- [ ] **Step 4: Implement the service, verdict and tool**

`apps/api/src/modules/protect/service.ts`:
```ts
import type { Search } from "../../ports/search.js";
import type { UrlReputation } from "../../ports/url-reputation.js";
import { PATTERNS } from "./patterns.js";
import { checkUrl } from "./urlcheck.js";

export type Risk = "HIGH" | "MEDIUM" | "LOW";

export interface InvestigationInput {
  text: string;
  urls?: string[];
  phones?: string[];
  senderClaim?: string;
}

export interface Investigation {
  risk: Risk;
  reasons: string[];
  webNote: string | null;
}

export interface ProtectService {
  investigate(input: InvestigationInput): Promise<Investigation>;
}

/** Stateless: records nothing. The tool decides what to persist. */
export function createProtectService({ search, urlReputation }: { search: Search; urlReputation: UrlReputation }): ProtectService {
  return {
    async investigate({ text, urls = [], phones = [], senderClaim }) {
      const patternReasons = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.why);
      const findings = await Promise.all(urls.map((url) => checkUrl(url, text, urlReputation)));
      const urlReasons = findings.flatMap((f) => f.flags.map((flag) => `Link ${f.host}: ${flag}`));

      const query = phones[0] ?? urls[0] ?? (senderClaim ? `${senderClaim} scam Malaysia` : text.slice(0, 60));
      const [top] = await search.search(`${query} scam report Malaysia`, 2);
      const webNote = top ? `${top.title} — ${top.url}` : null;

      const risk: Risk =
        findings.some((f) => f.suspicious) || patternReasons.length >= 2 ? "HIGH" : patternReasons.length === 1 ? "MEDIUM" : "LOW";

      return { risk, reasons: [...patternReasons, ...urlReasons], webNote };
    },
  };
}
```

`apps/api/src/modules/protect/verdict.ts`:
```ts
import type { Investigation } from "./service.js";

const HEADS = {
  HIGH: "🔴 LIKELY A SCAM",
  MEDIUM: "🟠 BE CAREFUL — POSSIBLE SCAM",
  LOW: "🟢 PROBABLY OK, BUT STAY ALERT",
} as const;

/** The tool result the model reads. The model rephrases it in the elder's language. */
export function renderVerdict({ risk, reasons, webNote }: Investigation): string {
  const lines: string[] = [HEADS[risk]];
  if (reasons.length > 0) lines.push("", "Why:", ...reasons.slice(0, 5).map((reason) => `• ${reason}`));
  lines.push(
    "",
    risk === "LOW"
      ? "Nothing obviously dangerous — but never share OTP/passwords, and if unsure, call the company on the number printed on your card."
      : "Do NOT click any link or share any OTP, password or bank details. If it claims to be your bank, call the number on the back of your card — not any number in this message.",
  );
  if (webNote) lines.push("", `Web check: ${webNote}`);
  return lines.join("\n");
}
```

`apps/api/src/modules/protect/tools.ts`:
```ts
import { z } from "zod";
import { defineTool, type ToolSet } from "../../agent/tool.js";
import type { EventsService } from "../events/service.js";
import type { ProtectService } from "./service.js";
import { renderVerdict } from "./verdict.js";

export function createProtectTools(protect: ProtectService, events: EventsService): ToolSet {
  return {
    investigate_message: defineTool({
      name: "investigate_message",
      description:
        "Investigate a suspicious message the user forwarded (as text or a screenshot). Pass the message text and " +
        "anything you extracted from it. Returns a risk verdict with reasons. Always call this before advising the user.",
      input: z.object({
        text: z.string().describe("The full text of the suspicious message"),
        urls: z.array(z.string()).optional().describe("Links found in the message"),
        phones: z.array(z.string()).optional().describe("Phone or bank-account numbers found in the message"),
        senderClaim: z.string().optional().describe("Who the sender claims to be, e.g. 'Maybank', 'PDRM'"),
      }),
      run: async (input, ctx) => {
        const result = await protect.investigate(input);
        if (result.risk === "HIGH") {
          events.record({
            elderId: ctx.elder.id,
            type: "scam_detected",
            severity: "high",
            summary: result.reasons[0] ? `Likely scam — ${result.reasons[0]}` : "Likely scam message",
            detail: {
              reasons: result.reasons.slice(0, 5),
              urls: input.urls ?? [],
              senderClaim: input.senderClaim ?? null,
              webNote: result.webNote,
            },
          });
        }
        return renderVerdict(result);
      },
    }),
  };
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/api/src/modules/protect && npm run typecheck -w @careguard/api`
Expected: 17 tests PASS; `tsc` exits 0. If "rates an ordinary family message LOW" fails, print `result.reasons` — a pattern regex is matching a Malay word and the test sentence, not the regex, should change only if the match is genuinely a scam signal.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/protect
git commit -m "feat(api): protect module — patterns, whole-word lookalike checks, verdicts, investigate tool"
```

---

### Task 8: Agent core — services composition, prompt, registry, runner, turn queue

**Files:**
- Create: `apps/api/src/services.ts`, `apps/api/src/test/harness.ts`, `apps/api/src/agent/prompts/careguard.ts`, `apps/api/src/agent/web-search-tool.ts`, `apps/api/src/agent/registry.ts`, `apps/api/src/agent/runner.ts`, `apps/api/src/agent/turn-queue.ts`
- Test: `apps/api/src/agent/registry.test.ts`, `apps/api/src/agent/runner.test.ts`, `apps/api/src/agent/turn-queue.test.ts`

**Interfaces:**
- Consumes: every service and tool factory from Tasks 4–7; ports, adapters and fakes from Task 3; `loadConfig`, `Config` (Task 2).
- Produces:
  - `services.ts`: `interface ServiceDeps { db: Db; clock: Clock; log: Logger; messenger: Messenger; scheduler: Scheduler; search: Search; urlReputation: UrlReputation }`, `interface Services { elders: EldersService; conversation: ConversationService; events: EventsService; family: FamilyService; reminders: RemindersService; understand: UnderstandService; protect: ProtectService; bus: EventBus }`, `createServices(deps: ServiceDeps): Services`
  - `test/harness.ts`: `createTestServices(overrides?: { search?: Search; urlReputation?: UrlReputation })` → `{ db, clock, messenger: CapturingMessenger, scheduler, search, urlReputation, services }`, `testConfig(env?: Record<string, string>): Config`
  - `prompts/careguard.ts`: `CAREGUARD_PROMPT: string`, `careguardSystemPrompt(now: Date): string`
  - `registry.ts`: `interface ToolServices { protect; events; family; reminders; understand; search }`, `buildTools(services: ToolServices): ToolSet`, `toolSchemas(tools: ToolSet): ChatCompletionTool[]`
  - `runner.ts`: `interface RunTurnInput { elder: Elder; system: string; history: ChatCompletionMessageParam[]; tools: ToolSet; llm: Llm; messenger: Messenger; clock: Clock; log: Logger; maxSteps?: number; onToolCall?: (name: string, args: unknown) => void }`, `interface TurnResult { reply: string; newMessages: ChatCompletionMessageParam[] }`, `STEP_LIMIT_REPLY: string`, `runTurn(input: RunTurnInput): Promise<TurnResult>`
  - `turn-queue.ts`: `interface TurnQueue { run<T>(key: string, task: () => Promise<T>): Promise<T>; idle(): Promise<void> }`, `createTurnQueue(): TurnQueue`

- [ ] **Step 1: Create the services composition and test harness**

These have no behaviour of their own; the registry and runner tests below exercise them.

`apps/api/src/services.ts`:
```ts
import type { Db } from "./infra/db.js";
import { createConversationRepo } from "./modules/conversation/repo.js";
import { createConversationService, type ConversationService } from "./modules/conversation/service.js";
import { createEldersRepo } from "./modules/elders/repo.js";
import { createEldersService, type EldersService } from "./modules/elders/service.js";
import { createEventBus, type EventBus } from "./modules/events/bus.js";
import { createEventsRepo } from "./modules/events/repo.js";
import { createEventsService, type EventsService } from "./modules/events/service.js";
import { createFamilyRepo } from "./modules/family/repo.js";
import { createFamilyService, type FamilyService } from "./modules/family/service.js";
import { createProtectService, type ProtectService } from "./modules/protect/service.js";
import { createRemindersRepo } from "./modules/reminders/repo.js";
import { createRemindersService, type RemindersService } from "./modules/reminders/service.js";
import { createUnderstandService, type UnderstandService } from "./modules/understand/service.js";
import type { Clock } from "./ports/clock.js";
import type { Logger } from "./ports/logger.js";
import type { Messenger } from "./ports/messenger.js";
import type { Scheduler } from "./ports/scheduler.js";
import type { Search } from "./ports/search.js";
import type { UrlReputation } from "./ports/url-reputation.js";

export interface ServiceDeps {
  db: Db;
  clock: Clock;
  log: Logger;
  /** Process-wide messenger: approvals and reminder nudges. Turns receive their own via ToolContext. */
  messenger: Messenger;
  scheduler: Scheduler;
  search: Search;
  urlReputation: UrlReputation;
}

export interface Services {
  elders: EldersService;
  conversation: ConversationService;
  events: EventsService;
  family: FamilyService;
  reminders: RemindersService;
  understand: UnderstandService;
  protect: ProtectService;
  bus: EventBus;
}

export function createServices({ db, clock, log, messenger, scheduler, search, urlReputation }: ServiceDeps): Services {
  const bus = createEventBus();
  const elders = createEldersService({ repo: createEldersRepo(db), clock });
  const conversation = createConversationService({ repo: createConversationRepo(db), clock });
  const events = createEventsService({ repo: createEventsRepo(db), bus, messenger, elders, clock, log });
  const family = createFamilyService({ repo: createFamilyRepo(db), clock, log });
  const reminders = createRemindersService({ repo: createRemindersRepo(db), elders, events, messenger, scheduler, clock, log });
  const understand = createUnderstandService({ events });
  const protect = createProtectService({ search, urlReputation });
  return { elders, conversation, events, family, reminders, understand, protect, bus };
}
```

`apps/api/src/test/harness.ts`:
```ts
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import { createInProcessScheduler } from "../adapters/in-process-scheduler.js";
import { loadConfig, type Config } from "../infra/config.js";
import type { Search } from "../ports/search.js";
import type { UrlReputation } from "../ports/url-reputation.js";
import { createServices } from "../services.js";
import { createTestDb } from "./db.js";
import { fakeSearch, fakeUrlReputation, fixedClock, silentLogger } from "./fakes.js";

export function createTestServices(overrides: { search?: Search; urlReputation?: UrlReputation } = {}) {
  const db = createTestDb();
  const clock = fixedClock();
  const messenger = new CapturingMessenger();
  const scheduler = createInProcessScheduler(clock, silentLogger);
  const search = overrides.search ?? fakeSearch();
  const urlReputation = overrides.urlReputation ?? fakeUrlReputation();
  const services = createServices({ db, clock, log: silentLogger, messenger, scheduler, search, urlReputation });
  return { db, clock, messenger, scheduler, search, urlReputation, services };
}

export type TestServices = ReturnType<typeof createTestServices>;

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ NODE_ENV: "test", ...env });
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/agent/registry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fakeSearch, testContext } from "../test/fakes.js";
import { createTestServices } from "../test/harness.js";
import { CAREGUARD_PROMPT, careguardSystemPrompt } from "./prompts/careguard.js";
import { buildTools, toolSchemas } from "./registry.js";

describe("buildTools", () => {
  it("exposes exactly the CareGuard tools", () => {
    const t = createTestServices();
    const tools = buildTools({ ...t.services, search: t.search });
    expect(Object.keys(tools).sort()).toEqual([
      "create_reminder",
      "investigate_message",
      "log_document",
      "notify_family",
      "register_family",
      "web_search",
    ]);
    expect(toolSchemas(tools).map((schema) => schema.function.name).sort()).toEqual(Object.keys(tools).sort());
  });

  it("web_search formats results and handles an empty result", async () => {
    const found = createTestServices({ search: fakeSearch([{ title: "PDRM scam list", url: "https://rmp.example", text: "Beware" }]) });
    await expect(
      buildTools({ ...found.services, search: found.search }).web_search!.run({ query: "PDRM scam" }, testContext()),
    ).resolves.toBe("[1] PDRM scam list\nhttps://rmp.example\nBeware");

    const empty = createTestServices();
    await expect(
      buildTools({ ...empty.services, search: empty.search }).web_search!.run({ query: "x" }, testContext()),
    ).resolves.toBe("No results found.");
  });
});

describe("careguardSystemPrompt", () => {
  it("keeps the communication-layer prompt and adds the date and tool guidance", () => {
    const prompt = careguardSystemPrompt(new Date("2026-09-13T03:00:00.000Z"));
    expect(prompt.startsWith(CAREGUARD_PROMPT)).toBe(true);
    expect(prompt).toContain("13 September 2026");
    expect(prompt).toContain("+08:00");
    expect(prompt).toContain("log_document");
  });

  it("uses the Malaysian calendar day, not UTC", () => {
    expect(careguardSystemPrompt(new Date("2026-09-13T20:00:00.000Z"))).toContain("14 September 2026");
  });
});
```

`apps/api/src/agent/runner.test.ts`:
```ts
import type { ChatCompletionMessage, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assistantText, assistantToolCall, FakeLlm, fakeSearch, silentLogger, type LlmResponder } from "../test/fakes.js";
import { createTestServices } from "../test/harness.js";
import { buildTools } from "./registry.js";
import { runTurn, STEP_LIMIT_REPLY, type RunTurnInput } from "./runner.js";
import { defineTool, type ToolSet } from "./tool.js";

const user = (text: string): ChatCompletionUserMessageParam => ({ role: "user", content: [{ type: "text", text }] });
const SCAM = "Akaun Maybank anda telah disekat. Sila sahkan segera di maybank-verify.xyz";

function setup(llm: FakeLlm, searchDelayMs = 0) {
  const t = createTestServices({ search: fakeSearch([], searchDelayMs) });
  const tools = buildTools({ ...t.services, search: t.search });
  const mak = t.services.elders.findOrCreateByPhone("whatsapp:+60123456789", "Mak");
  const tok = t.services.elders.findOrCreateByPhone("whatsapp:+60199999999", "Tok");
  const turn = (overrides: Partial<RunTurnInput> = {}) =>
    runTurn({
      elder: mak,
      system: "test system",
      history: [user("Hai")],
      tools,
      llm,
      messenger: t.messenger,
      clock: t.clock,
      log: silentLogger,
      ...overrides,
    });
  return { ...t, mak, tok, turn };
}

describe("runTurn", () => {
  it("returns a plain text reply", async () => {
    const llm = FakeLlm.scripted([assistantText("Hai Mak!")]);
    const { turn } = setup(llm);

    await expect(turn()).resolves.toEqual({ reply: "Hai Mak!", newMessages: [{ role: "assistant", content: "Hai Mak!" }] });
    expect(llm.requests[0]!.system).toBe("test system");
    expect(llm.requests[0]!.messages).toEqual([user("Hai")]);
    expect(llm.requests[0]!.tools.map((tool) => tool.function.name)).toContain("investigate_message");
  });

  it("runs tool calls for the current elder and feeds results back", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("log_document", { kind: "bill", summary: "TNB bill RM143" }, "call_1"),
      assistantText("Ini bil TNB."),
    ]);
    const { turn, services, mak } = setup(llm);
    const called: string[] = [];

    const result = await turn({ onToolCall: (name) => called.push(name) });

    expect(result.reply).toBe("Ini bil TNB.");
    expect(result.newMessages.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(result.newMessages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Logged for the family timeline." });
    expect(llm.requests[1]!.messages.at(-1)).toEqual(result.newMessages[1]);
    expect(called).toEqual(["log_document"]);
    expect(services.events.list({ elderId: mak.id })).toHaveLength(1);
  });

  it("reports unknown tools and unparseable arguments back to the model", async () => {
    const badJson: ChatCompletionMessage = {
      role: "assistant",
      content: null,
      refusal: null,
      tool_calls: [{ id: "call_2", type: "function", function: { name: "log_document", arguments: "{not json" } }],
    };
    const llm = FakeLlm.scripted([assistantToolCall("launch_rocket", {}, "call_1"), badJson, assistantText("Maaf.")]);
    const { turn } = setup(llm);

    const { newMessages } = await turn();

    expect(newMessages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Unknown tool: launch_rocket" });
    expect((newMessages[3] as { content: string }).content).toMatch(/^Invalid arguments for log_document/);
  });

  it("turns a tool exception into text", async () => {
    const boom: ToolSet = {
      boom: defineTool({
        name: "boom",
        description: "Always fails.",
        input: z.object({}),
        run: async () => {
          throw new Error("kaput");
        },
      }),
    };
    const llm = FakeLlm.scripted([assistantToolCall("boom", {}, "call_1"), assistantText("ok")]);
    const { turn } = setup(llm);

    const { newMessages } = await turn({ tools: boom });

    expect(newMessages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: 'Tool "boom" failed: kaput' });
  });

  it("stops at the step limit with a fallback reply", async () => {
    const llm = new FakeLlm(() => assistantToolCall("log_document", { kind: "other", summary: "loop" }));
    const { turn } = setup(llm);

    const result = await turn({ maxSteps: 2 });

    expect(result.reply).toBe(STEP_LIMIT_REPLY);
    expect(llm.requests).toHaveLength(2);
  });

  it("P2 regression: concurrent turns record events against their own elder", async () => {
    const respond: LlmResponder = (request) => {
      const last = request.messages.at(-1)!;
      if (last.role === "tool") return assistantText("Hati-hati, itu scam.");
      return JSON.stringify(last.content).includes("disekat")
        ? assistantToolCall("investigate_message", { text: SCAM, urls: ["maybank-verify.xyz"] })
        : assistantText("Hai!");
    };
    // The 20 ms search stalls Mak's tool call while Tok's whole turn completes.
    const { turn, services, mak, tok } = setup(new FakeLlm(respond), 20);

    await Promise.all([turn({ elder: mak, history: [user(SCAM)] }), turn({ elder: tok, history: [user("Hai CareGuard")] })]);

    expect(services.events.list({ elderId: mak.id }).map((e) => e.type)).toEqual(["scam_detected"]);
    expect(services.events.list({ elderId: tok.id })).toEqual([]);
  });
});
```

`apps/api/src/agent/turn-queue.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTurnQueue } from "./turn-queue.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createTurnQueue", () => {
  it("runs tasks for the same key one at a time, in order", async () => {
    const queue = createTurnQueue();
    const log: string[] = [];
    const first = queue.run("eld_1", async () => {
      log.push("1:start");
      await sleep(20);
      log.push("1:end");
      return 1;
    });
    const second = queue.run("eld_1", async () => {
      log.push("2:start");
      return 2;
    });

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(log).toEqual(["1:start", "1:end", "2:start"]);
  });

  it("runs different keys concurrently", async () => {
    const queue = createTurnQueue();
    const log: string[] = [];
    const a = queue.run("eld_a", async () => {
      log.push("a:start");
      await sleep(20);
      log.push("a:end");
    });
    const b = queue.run("eld_b", async () => {
      log.push("b");
    });

    await Promise.all([a, b]);
    expect(log).toEqual(["a:start", "b", "a:end"]);
  });

  it("keeps processing after a task fails", async () => {
    const queue = createTurnQueue();
    await expect(queue.run("eld_1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(queue.run("eld_1", async () => "next")).resolves.toBe("next");
  });

  it("idle() waits for in-flight tasks", async () => {
    const queue = createTurnQueue();
    let done = false;
    void queue.run("eld_1", async () => {
      await sleep(20);
      done = true;
    });
    await queue.idle();
    expect(done).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run apps/api/src/agent`
Expected: FAIL — `registry.js`, `runner.js`, `turn-queue.js`, `prompts/careguard.js` not found (`tool.test.ts` still passes).

- [ ] **Step 4: Implement the prompt, web search tool and registry**

`apps/api/src/agent/prompts/careguard.ts` — `CAREGUARD_PROMPT` is the `CAREGUARD` constant from `src/surfaces/careguard.ts`, **verbatim**:
```ts
// THE COMMUNICATION LAYER — this prompt IS the core innovation.
export const CAREGUARD_PROMPT = `You are "CareGuard", a warm, patient helper for elderly people in Malaysia. You speak like a kind grandchild — never like a computer.

HOW YOU TALK (this matters most):
- Reply in the SAME language the user used — English, Bahasa Melayu, Chinese, Tamil, or natural Malaysian mix (Manglish). Match their style.
- Keep it SHORT. A few simple sentences. No jargon, no technical words, no long paragraphs.
- Be calm and reassuring. Never make them feel rushed or stupid.
- If asked to phrase something "for my son/daughter", write a clear, complete version for that family member instead of the simplified one.

WHAT YOU DO when they send a photo or message:
1) A BILL, LETTER, APPOINTMENT or confusing document → read it and explain simply: what it is, the important number(s) and date(s), and what they need to do. Example: "Ini bil elektrik TNB. Bulan ni RM143, kena bayar sebelum 25 September." Then gently offer: "Nak saya ingatkan awak nanti?" If yes, call create_reminder.
2) A SUSPICIOUS message, link, or "bank/police/parcel" notice → call investigate_message with what you found (text, links, numbers, who it claims to be). Do NOT judge it yourself — use the tool's result. Then explain the verdict simply and kindly. If it's risky, tell them clearly: do not click, do not share any OTP/password. Then offer: "Nak saya beritahu anak awak?" If yes, use register_family (if no number saved) then notify_family.

SAFETY: You flag and advise, you never guarantee. Never tell them to click a link or share an OTP/TAC/password. If unsure about a bank message, tell them to call the number on the back of your card.

You understand, you protect, and you act — and you always sound human.`;

export function careguardSystemPrompt(now: Date): string {
  const today = now.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    `${CAREGUARD_PROMPT}\n\n` +
    `Today is ${today} (Malaysia time, UTC+8). When a reminder has a clear date and time, pass dueAt as ISO-8601 with +08:00. ` +
    "After explaining a bill, letter or appointment, call log_document once so the family timeline shows it."
  );
}
```

Before committing, confirm the prompt is unchanged: `diff <(sed -n '/^const CAREGUARD = `/,/`;$/p' src/surfaces/careguard.ts | sed '1s/^const CAREGUARD = `//;$s/`;$//') <(sed -n '/^export const CAREGUARD_PROMPT = `/,/`;$/p' apps/api/src/agent/prompts/careguard.ts | sed '1s/^export const CAREGUARD_PROMPT = `//;$s/`;$//')` — expected: no output.

`apps/api/src/agent/web-search-tool.ts`:
```ts
import { z } from "zod";
import type { Search } from "../ports/search.js";
import { defineTool, type ToolSet } from "./tool.js";

export function createWebSearchTool(search: Search): ToolSet {
  return {
    web_search: defineTool({
      name: "web_search",
      description: "Search the web for current information, e.g. whether an organisation, website or phone number is legitimate.",
      input: z.object({ query: z.string().describe("The search query") }),
      run: async ({ query }) => {
        const results = await search.search(query, 5);
        if (results.length === 0) return "No results found.";
        return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${(r.text ?? "").slice(0, 400)}`).join("\n\n");
      },
    }),
  };
}
```

`apps/api/src/agent/registry.ts`:
```ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { EventsService } from "../modules/events/service.js";
import type { FamilyService } from "../modules/family/service.js";
import { createFamilyTools } from "../modules/family/tools.js";
import type { ProtectService } from "../modules/protect/service.js";
import { createProtectTools } from "../modules/protect/tools.js";
import type { RemindersService } from "../modules/reminders/service.js";
import { createReminderTools } from "../modules/reminders/tools.js";
import type { UnderstandService } from "../modules/understand/service.js";
import { createUnderstandTools } from "../modules/understand/tools.js";
import type { Search } from "../ports/search.js";
import type { ToolSet } from "./tool.js";
import { createWebSearchTool } from "./web-search-tool.js";

export interface ToolServices {
  protect: ProtectService;
  events: EventsService;
  family: FamilyService;
  reminders: RemindersService;
  understand: UnderstandService;
  search: Search;
}

export function buildTools(s: ToolServices): ToolSet {
  return {
    ...createProtectTools(s.protect, s.events),
    ...createFamilyTools(s.family),
    ...createReminderTools(s.reminders),
    ...createUnderstandTools(s.understand),
    ...createWebSearchTool(s.search),
  };
}

export function toolSchemas(tools: ToolSet): ChatCompletionTool[] {
  return Object.values(tools).map((tool) => tool.schema);
}
```

- [ ] **Step 5: Implement the runner and turn queue**

`apps/api/src/agent/runner.ts`:
```ts
import type { Elder } from "@careguard/shared";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { Clock } from "../ports/clock.js";
import type { Llm } from "../ports/llm.js";
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";
import { toolSchemas } from "./registry.js";
import type { ToolContext, ToolSet } from "./tool.js";

export interface RunTurnInput {
  elder: Elder;
  system: string;
  /** Conversation so far, ending with the elder's new message. */
  history: ChatCompletionMessageParam[];
  tools: ToolSet;
  llm: Llm;
  messenger: Messenger;
  clock: Clock;
  log: Logger;
  maxSteps?: number;
  onToolCall?: (name: string, args: unknown) => void;
}

export interface TurnResult {
  reply: string;
  /** Messages produced this turn (assistant + tool), for the caller to persist. */
  newMessages: ChatCompletionMessageParam[];
}

export const STEP_LIMIT_REPLY =
  "Maaf, saya perlukan sedikit masa lagi. Boleh hantar semula dengan ringkas?\nSorry, could you send that again more simply?";

export async function runTurn(input: RunTurnInput): Promise<TurnResult> {
  const { elder, system, history, tools, llm, messenger, clock, log, maxSteps = 6, onToolCall } = input;
  const ctx: ToolContext = { elder, messenger, clock, log };
  const schemas = toolSchemas(tools);
  const newMessages: ChatCompletionMessageParam[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const message = await llm.complete({ system, messages: [...history, ...newMessages], tools: schemas });
    const toolCalls = message.tool_calls ?? [];
    const assistant: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: message.content,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    newMessages.push(assistant);

    if (toolCalls.length === 0) return { reply: message.content ?? "", newMessages };

    for (const call of toolCalls) {
      const name = call.function.name;
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // Leave args empty; the tool's validation reports what is missing.
      }
      onToolCall?.(name, args);

      let content: string;
      const tool = tools[name];
      if (!tool) {
        content = `Unknown tool: ${name}`;
      } else {
        try {
          content = await tool.run(args, ctx);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          log.error("tool failed", { tool: name, elderId: elder.id, error: detail });
          content = `Tool "${name}" failed: ${detail}`;
        }
      }
      newMessages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { reply: STEP_LIMIT_REPLY, newMessages };
}
```

`apps/api/src/agent/turn-queue.ts`:
```ts
export interface TurnQueue {
  /** Runs `task` after every earlier task with the same key has settled. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Resolves once no task is queued or running. */
  idle(): Promise<void>;
}

export function createTurnQueue(): TurnQueue {
  const tails = new Map<string, Promise<void>>();

  return {
    run(key, task) {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(task);
      const tail = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    async idle() {
      while (tails.size > 0) await Promise.all(tails.values());
    },
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/api/src/agent && npm run typecheck -w @careguard/api`
Expected: all agent tests PASS (registry 4, runner 6, turn-queue 4, tool 3); `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services.ts apps/api/src/test/harness.ts apps/api/src/agent
git commit -m "feat(api): agent runner with per-turn context, per-elder turn queue, tool registry, CareGuard prompt"
```

---

### Task 9: HTTP layer — app, errors, CORS, auth seam, SSE, routes

**Files:**
- Create: `apps/api/src/http/{errors,cors,require-family,sse,app}.ts`, `apps/api/src/modules/elders/routes.ts`, `apps/api/src/modules/events/routes.ts`, `apps/api/src/modules/reminders/routes.ts`
- Test: `apps/api/src/http/app.test.ts`, `apps/api/src/http/sse.test.ts`

**Interfaces:**
- Consumes: `Services` (Task 8), `Config`, `Logger`, `EventBus`, `REASSURANCE`, domain errors, `createTestServices`, `testConfig`.
- Produces:
  - `interface AppDeps { config: Config; log: Logger; services: Services; checkDb: () => boolean; whatsappWebhook: RequestHandler; simulate: RequestHandler }`, `createApp(deps: AppDeps): Express`
  - `errorHandler(log: Logger): ErrorRequestHandler`, `notFoundHandler: RequestHandler`, `cors(origin: string): RequestHandler`, `requireFamily: RequestHandler`, `createStreamHandler(bus: EventBus, opts?: { heartbeatMs?: number }): RequestHandler`
  - `createEldersRouter(elders)`, `createEventsRouter(events)`, `createRemindersRouter(reminders)` — each returns an Express `Router`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/http/app.test.ts`:
```ts
import type { RequestHandler } from "express";
import request from "supertest";
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
```

`apps/api/src/http/sse.test.ts`:
```ts
import type { CareEvent } from "@careguard/shared";
import express from "express";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../modules/events/bus.js";
import { createStreamHandler } from "./sse.js";

const event: CareEvent = {
  id: "evt_1",
  elderId: "eld_1",
  type: "scam_detected",
  severity: "high",
  summary: "Likely scam",
  detail: {},
  status: "new",
  createdAt: "2026-09-13T03:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
};

describe("createStreamHandler", () => {
  it("streams bus messages as server-sent events", async () => {
    const bus = createEventBus();
    const app = express();
    app.get("/stream", createStreamHandler(bus));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/stream`);
      expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      let text = decoder.decode((await reader.read()).value);
      expect(text).toContain(": connected");

      bus.publish({ type: "event.created", event });
      while (!text.includes("event.created")) text += decoder.decode((await reader.read()).value);
      expect(text).toContain(`data: ${JSON.stringify({ type: "event.created", event })}\n\n`);
      await reader.cancel();
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/api/src/http`
Expected: FAIL — `./app.js` and `./sse.js` not found.

- [ ] **Step 3: Implement the HTTP building blocks**

`apps/api/src/http/errors.ts`:
```ts
import type { ApiError } from "@careguard/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";
import type { Logger } from "../ports/logger.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } } satisfies ApiError);
};

export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const send = (status: number, code: string, message: string) => {
      res.status(status).json({ error: { code, message } } satisfies ApiError);
    };

    if (err instanceof z.ZodError) return send(400, "validation_error", z.prettifyError(err));
    if (err instanceof ValidationError) return send(400, err.code, err.message);
    if (err instanceof NotFoundError) return send(404, err.code, err.message);
    if (err instanceof ConflictError) return send(409, err.code, err.message);

    // body-parser errors (malformed JSON, payload too large) carry a 4xx `status`.
    const status = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status < 500) return send(status, "bad_request", err instanceof Error ? err.message : "Bad request");

    log.error("unhandled error", { error: err instanceof Error ? err.message : String(err) });
    send(500, "internal_error", "Something went wrong");
  };
}
```

`apps/api/src/http/cors.ts`:
```ts
import type { RequestHandler } from "express";

export function cors(origin: string): RequestHandler {
  return (req, res, next) => {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Headers", "content-type, authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
```

`apps/api/src/http/require-family.ts`:
```ts
import type { RequestHandler } from "express";

/**
 * Authorisation seam for every /api route. Open for now.
 * Auth0 (event day) replaces this body: verify the token, resolve auth0_sub → family member → elders.
 */
export const requireFamily: RequestHandler = (_req, _res, next) => {
  next();
};
```

`apps/api/src/http/sse.ts`:
```ts
import type { RequestHandler } from "express";
import type { EventBus } from "../modules/events/bus.js";

export function createStreamHandler(bus: EventBus, { heartbeatMs = 25_000 }: { heartbeatMs?: number } = {}): RequestHandler {
  return (req, res) => {
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write(": connected\n\n");

    const unsubscribe = bus.subscribe((message) => {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), heartbeatMs);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}
```

- [ ] **Step 4: Implement the routers and the app**

`apps/api/src/modules/elders/routes.ts`:
```ts
import type { ElderListResponse } from "@careguard/shared";
import { Router } from "express";
import type { EldersService } from "./service.js";

export function createEldersRouter(elders: EldersService): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ elders: elders.list() } satisfies ElderListResponse);
  });
  router.get("/:id", (req, res) => {
    res.json(elders.get(req.params.id));
  });
  return router;
}
```

`apps/api/src/modules/events/routes.ts`:
```ts
import { ListEventsQuery, type EventListResponse } from "@careguard/shared";
import { Router } from "express";
import type { EventsService } from "./service.js";

export function createEventsRouter(events: EventsService): Router {
  const router = Router();
  router.get("/", (req, res) => {
    res.json({ events: events.list(ListEventsQuery.parse(req.query)) } satisfies EventListResponse);
  });
  router.get("/:id", (req, res) => {
    res.json(events.get(req.params.id));
  });
  // `by` stays null until Auth0 identifies the family member.
  router.post("/:id/approve", async (req, res) => {
    res.json(await events.approve(req.params.id, null));
  });
  router.post("/:id/dismiss", (req, res) => {
    res.json(events.dismiss(req.params.id, null));
  });
  return router;
}
```

`apps/api/src/modules/reminders/routes.ts`:
```ts
import { ListRemindersQuery, type ReminderListResponse } from "@careguard/shared";
import { Router } from "express";
import type { RemindersService } from "./service.js";

export function createRemindersRouter(reminders: RemindersService): Router {
  const router = Router();
  router.get("/", (req, res) => {
    const { elderId } = ListRemindersQuery.parse(req.query);
    res.json({ reminders: reminders.list(elderId) } satisfies ReminderListResponse);
  });
  return router;
}
```

`apps/api/src/http/app.ts`:
```ts
import express, { type Express, type RequestHandler } from "express";
import type { Config } from "../infra/config.js";
import { createEldersRouter } from "../modules/elders/routes.js";
import { createEventsRouter } from "../modules/events/routes.js";
import { createRemindersRouter } from "../modules/reminders/routes.js";
import type { Logger } from "../ports/logger.js";
import type { Services } from "../services.js";
import { cors } from "./cors.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { requireFamily } from "./require-family.js";
import { createStreamHandler } from "./sse.js";

export interface AppDeps {
  config: Config;
  log: Logger;
  services: Services;
  checkDb: () => boolean;
  whatsappWebhook: RequestHandler;
  simulate: RequestHandler;
}

export function createApp({ config, log, services, checkDb, whatsappWebhook, simulate }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req, res) => {
    res.json({ ok: true, db: checkDb(), fallbacks: config.fallbacks });
  });

  app.post("/whatsapp", express.urlencoded({ extended: false }), whatsappWebhook);

  const api = express.Router();
  api.use(cors(config.dashboardOrigin));
  api.use(express.json({ limit: "1mb" }));
  api.use(requireFamily);
  api.use("/elders", createEldersRouter(services.elders));
  api.use("/events", createEventsRouter(services.events));
  api.use("/reminders", createRemindersRouter(services.reminders));
  api.get("/stream", createStreamHandler(services.bus));
  app.use("/api", api);

  if (config.env !== "production") app.post("/dev/simulate", express.json(), simulate);

  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/api/src/http && npm run typecheck -w @careguard/api`
Expected: 14 tests PASS; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/http apps/api/src/modules/elders/routes.ts apps/api/src/modules/events/routes.ts apps/api/src/modules/reminders/routes.ts
git commit -m "feat(api): HTTP app with Events API, SSE stream, CORS, error mapping, auth seam"
```

---

### Task 10: Inbound pipeline, WhatsApp webhook and dev simulator

**Files:**
- Create: `apps/api/src/agent/pipeline.ts`, `apps/api/src/channels/whatsapp/{signature,inbound,webhook}.ts`, `apps/api/src/channels/simulate.ts`, `apps/api/src/test/twilio-fixture.ts`
- Test: `apps/api/src/agent/pipeline.test.ts`, `apps/api/src/channels/whatsapp/signature.test.ts`, `apps/api/src/channels/whatsapp/inbound.test.ts`, `apps/api/src/channels/whatsapp/webhook.test.ts`

**Interfaces:**
- Consumes: `Services`, `createTestServices`, `testConfig` (Task 8), `runTurn`, `buildTools`, `createTurnQueue`, `careguardSystemPrompt` (Task 8), `createApp` (Task 9), `MediaFetcher`, `noMedia`, `CapturingMessenger`, `toWhatsApp`, `normalizePhone` (Task 3).
- Produces:
  - `pipeline.ts`: `FALLBACK_REPLY`, `interface InboundTurn { phone: string; message: ChatCompletionUserMessageParam; externalId?: string | null; messenger: Messenger; onToolCall?: (name: string, args: unknown) => void }`, `interface InboundResult { status: "replied" | "duplicate" | "failed"; reply: string | null; events: CareEvent[] }`, `interface InboundPipeline { handle(turn: InboundTurn): Promise<InboundResult>; idle(): Promise<void> }`, `createInboundPipeline({ services, tools, llm, queue, clock, log, systemPrompt? }): InboundPipeline`
  - `signature.ts`: `computeTwilioSignature(authToken, url, params: Record<string, string>): string`, `isValidTwilioSignature(authToken, url, params, signature: string | undefined): boolean`
  - `inbound.ts`: `interface TwilioInbound { from: string; body: string; messageSid: string | null; media: { url: string; contentType: string }[] }`, `parseTwilioForm(form: Record<string, unknown>): TwilioInbound`, `toUserMessage(inbound, fetchMedia): Promise<ChatCompletionUserMessageParam>`
  - `webhook.ts`: `EMPTY_TWIML`, `interface WhatsAppWebhookDeps { pipeline: Pick<InboundPipeline, "handle">; messenger: Messenger; fetchMedia: MediaFetcher; log: Logger; signature?: { authToken: string; publicUrl: string } }`, `createWhatsAppWebhook(deps): RequestHandler`
  - `simulate.ts`: `createSimulateHandler(pipeline: Pick<InboundPipeline, "handle">): RequestHandler`

- [ ] **Step 1: Create the Twilio fixture**

`apps/api/src/test/twilio-fixture.ts`:
```ts
/**
 * Known-good Twilio webhook signature, generated with the official `twilio` package
 * (`getExpectedTwilioSignature`) and cross-checked by hand on 2026-09-13.
 */
export const TWILIO_FIXTURE = {
  authToken: "12345",
  publicUrl: "https://careguard.example.com",
  url: "https://careguard.example.com/whatsapp",
  params: {
    AccountSid: "AC00000000000000000000000000000000",
    Body: "Maybank: akaun anda disekat",
    From: "whatsapp:+60123456789",
    MessageSid: "SM11111111111111111111111111111111",
    NumMedia: "0",
    To: "whatsapp:+14155238886",
  },
  signature: "cKdxRAW6uny0GQf5Nra5cwtXl9Y=",
};
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/channels/whatsapp/signature.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TWILIO_FIXTURE as F } from "../../test/twilio-fixture.js";
import { computeTwilioSignature, isValidTwilioSignature } from "./signature.js";

describe("Twilio signature", () => {
  it("matches Twilio's reference implementation", () => {
    expect(computeTwilioSignature(F.authToken, F.url, F.params)).toBe(F.signature);
  });

  it("accepts a valid signature", () => {
    expect(isValidTwilioSignature(F.authToken, F.url, F.params, F.signature)).toBe(true);
  });

  it("rejects a tampered body, wrong token, wrong URL, or missing header", () => {
    expect(isValidTwilioSignature(F.authToken, F.url, { ...F.params, Body: "changed" }, F.signature)).toBe(false);
    expect(isValidTwilioSignature("other-token", F.url, F.params, F.signature)).toBe(false);
    expect(isValidTwilioSignature(F.authToken, `${F.url}/x`, F.params, F.signature)).toBe(false);
    expect(isValidTwilioSignature(F.authToken, F.url, F.params, undefined)).toBe(false);
  });
});
```

`apps/api/src/channels/whatsapp/inbound.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { parseTwilioForm, toUserMessage } from "./inbound.js";

describe("parseTwilioForm", () => {
  it("extracts sender, trimmed body, message id and media", () => {
    expect(
      parseTwilioForm({
        From: "whatsapp:+60123456789",
        Body: "  Bil apa ni?  ",
        MessageSid: "SM1",
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/0",
        MediaContentType0: "image/jpeg",
        MediaUrl1: "https://api.twilio.com/media/1",
        MediaContentType1: "audio/ogg",
      }),
    ).toEqual({
      from: "whatsapp:+60123456789",
      body: "Bil apa ni?",
      messageSid: "SM1",
      media: [
        { url: "https://api.twilio.com/media/0", contentType: "image/jpeg" },
        { url: "https://api.twilio.com/media/1", contentType: "audio/ogg" },
      ],
    });
  });

  it("tolerates missing fields", () => {
    expect(parseTwilioForm({ From: "whatsapp:+60123456789" })).toEqual({
      from: "whatsapp:+60123456789",
      body: "",
      messageSid: null,
      media: [],
    });
  });
});

describe("toUserMessage", () => {
  const inbound = (overrides = {}) => ({ from: "whatsapp:+60123456789", body: "", messageSid: "SM1", media: [], ...overrides });

  it("combines text with downloaded images and skips other media", async () => {
    const fetchMedia = vi.fn(async (url: string) => (url.endsWith("/0") ? "data:image/jpeg;base64,AAAA" : null));
    const message = await toUserMessage(
      inbound({
        body: "Bil apa ni?",
        media: [
          { url: "https://api.twilio.com/media/0", contentType: "image/jpeg" },
          { url: "https://api.twilio.com/media/1", contentType: "audio/ogg" },
        ],
      }),
      fetchMedia,
    );
    expect(message).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Bil apa ni?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    });
    expect(fetchMedia).toHaveBeenCalledTimes(1);
  });

  it("drops an image that could not be downloaded", async () => {
    const message = await toUserMessage(
      inbound({ body: "Tengok ni", media: [{ url: "https://api.twilio.com/media/0", contentType: "image/png" }] }),
      async () => null,
    );
    expect(message.content).toEqual([{ type: "text", text: "Tengok ni" }]);
  });

  it("marks an empty message", async () => {
    await expect(toUserMessage(inbound(), async () => null)).resolves.toEqual({
      role: "user",
      content: [{ type: "text", text: "(no content)" }],
    });
  });
});
```

`apps/api/src/agent/pipeline.test.ts`:
```ts
import type { ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import { assistantText, assistantToolCall, FakeLlm, fakeSearch, silentLogger, type LlmResponder } from "../test/fakes.js";
import { createTestServices } from "../test/harness.js";
import { createInboundPipeline, FALLBACK_REPLY } from "./pipeline.js";
import { buildTools } from "./registry.js";
import { createTurnQueue } from "./turn-queue.js";

const MAK = "whatsapp:+60123456789";
const TOK = "whatsapp:+60199999999";
const SCAM = "Akaun Maybank anda telah disekat. Sila sahkan segera di maybank-verify.xyz";
const text = (t: string): ChatCompletionUserMessageParam => ({ role: "user", content: [{ type: "text", text: t }] });

function setup(llm: FakeLlm, searchDelayMs = 0) {
  const t = createTestServices({ search: fakeSearch([], searchDelayMs) });
  const tools = buildTools({ ...t.services, search: t.search });
  const pipeline = createInboundPipeline({ services: t.services, tools, llm, queue: createTurnQueue(), clock: t.clock, log: silentLogger });
  return { ...t, pipeline };
}

describe("InboundPipeline", () => {
  it("creates the elder, replies through the turn's messenger, and persists the exchange", async () => {
    const llm = FakeLlm.scripted([assistantText("Hai Mak!")]);
    const { pipeline, messenger, services } = setup(llm);

    const result = await pipeline.handle({ phone: MAK, message: text("Hai"), externalId: "SM1", messenger });

    expect(result).toEqual({ status: "replied", reply: "Hai Mak!", events: [] });
    expect(messenger.sent).toEqual([{ to: MAK, body: "Hai Mak!" }]);
    const [elder] = services.elders.list();
    expect(elder!.phone).toBe(MAK);
    expect(services.conversation.window(elder!.id).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(llm.requests[0]!.system).toContain('You are "CareGuard"');
  });

  it("ignores a duplicate Twilio message", async () => {
    const llm = FakeLlm.scripted([assistantText("Hai Mak!")]);
    const { pipeline, messenger } = setup(llm);

    await pipeline.handle({ phone: MAK, message: text("Hai"), externalId: "SM1", messenger });
    const again = await pipeline.handle({ phone: MAK, message: text("Hai"), externalId: "SM1", messenger });

    expect(again).toEqual({ status: "duplicate", reply: null, events: [] });
    expect(llm.requests).toHaveLength(1);
    expect(messenger.sent).toHaveLength(1);
  });

  it("sends the fallback reply when the model fails, keeping the elder's message", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("OPENAI_API_KEY is not set");
    });
    const { pipeline, messenger, services } = setup(llm);

    const result = await pipeline.handle({ phone: MAK, message: text("Hai"), messenger });

    expect(result).toEqual({ status: "failed", reply: FALLBACK_REPLY, events: [] });
    expect(messenger.sent).toEqual([{ to: MAK, body: FALLBACK_REPLY }]);
    expect(services.conversation.window(services.elders.list()[0]!.id)).toHaveLength(1);
  });

  it("falls back when the model returns an empty reply", async () => {
    const { pipeline, messenger } = setup(FakeLlm.scripted([assistantText("  ")]));
    await expect(pipeline.handle({ phone: MAK, message: text("Hai"), messenger })).resolves.toMatchObject({
      status: "replied",
      reply: FALLBACK_REPLY,
    });
  });

  it("shows the photo to the model but stores [photo]", async () => {
    const llm = FakeLlm.scripted([assistantText("Ini bil TNB.")]);
    const { pipeline, messenger, services } = setup(llm);
    const photo: ChatCompletionUserMessageParam = {
      role: "user",
      content: [
        { type: "text", text: "Bil apa ni?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    };

    await pipeline.handle({ phone: MAK, message: photo, messenger });

    expect(llm.requests[0]!.messages.at(-1)).toEqual(photo);
    expect(services.conversation.window(services.elders.list()[0]!.id)[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Bil apa ni?" }, { type: "text", text: "[photo]" }],
    });
  });

  it("reports events recorded during the turn", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("log_document", { kind: "bill", summary: "TNB bill RM143" }),
      assistantText("Ini bil TNB."),
    ]);
    const { pipeline, messenger } = setup(llm);
    const result = await pipeline.handle({ phone: MAK, message: text("[photo of bill]"), messenger });
    expect(result.events.map((e) => e.type)).toEqual(["bill_explained"]);
  });

  it("sends family alerts through the turn's messenger, not the process messenger", async () => {
    const llm = FakeLlm.scripted([
      assistantToolCall("register_family", { phone: "0123456789", name: "Aisyah" }, "c1"),
      assistantToolCall("notify_family", { summary: "fake Maybank SMS" }, "c2"),
      assistantText("Dah beritahu Aisyah."),
    ]);
    const { pipeline, messenger: processMessenger } = setup(llm);
    const turnMessenger = new CapturingMessenger();

    await pipeline.handle({ phone: TOK, message: text("Tolong beritahu anak saya"), messenger: turnMessenger });

    expect(turnMessenger.sent.map((m) => m.to)).toEqual(["+60123456789", TOK]);
    expect(processMessenger.sent).toEqual([]);
  });

  it("P2 regression: concurrent elders keep their own events and replies", async () => {
    const respond: LlmResponder = (request) => {
      const last = request.messages.at(-1)!;
      if (last.role === "tool") return assistantText("Hati-hati, itu scam.");
      return JSON.stringify(last.content).includes("disekat")
        ? assistantToolCall("investigate_message", { text: SCAM, urls: ["maybank-verify.xyz"] })
        : assistantText("Hai!");
    };
    const { pipeline, messenger, services } = setup(new FakeLlm(respond), 20);

    await Promise.all([
      pipeline.handle({ phone: MAK, message: text(SCAM), messenger }),
      pipeline.handle({ phone: TOK, message: text("Hai CareGuard"), messenger }),
    ]);

    const [mak, tok] = [services.elders.list().find((e) => e.phone === MAK)!, services.elders.list().find((e) => e.phone === TOK)!];
    expect(services.events.list({ elderId: mak.id }).map((e) => e.type)).toEqual(["scam_detected"]);
    expect(services.events.list({ elderId: tok.id })).toEqual([]);
    expect(messenger.sent).toEqual(
      expect.arrayContaining([
        { to: MAK, body: "Hati-hati, itu scam." },
        { to: TOK, body: "Hai!" },
      ]),
    );
  });

  it("processes one elder's messages in order, each seeing the previous reply", async () => {
    const llm = new FakeLlm((_request, index) => assistantText(`reply ${index}`));
    const { pipeline, messenger } = setup(llm);

    await Promise.all([
      pipeline.handle({ phone: MAK, message: text("first"), messenger }),
      pipeline.handle({ phone: MAK, message: text("second"), messenger }),
    ]);

    expect(llm.requests[1]!.messages).toEqual([text("first"), { role: "assistant", content: "reply 0" }, text("second")]);
  });
});
```

`apps/api/src/channels/whatsapp/webhook.test.ts`:
```ts
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run apps/api/src/agent/pipeline.test.ts apps/api/src/channels`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement signature and inbound parsing**

`apps/api/src/channels/whatsapp/signature.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** Twilio's scheme: HMAC-SHA1 over the full URL followed by each POST param as key+value, keys sorted. */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

`apps/api/src/channels/whatsapp/inbound.ts`:
```ts
import type { ChatCompletionContentPart, ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import type { MediaFetcher } from "../../adapters/twilio-media.js";

export interface TwilioInbound {
  from: string;
  body: string;
  messageSid: string | null;
  media: { url: string; contentType: string }[];
}

export function parseTwilioForm(form: Record<string, unknown>): TwilioInbound {
  const field = (key: string) => (typeof form[key] === "string" ? (form[key] as string) : "");
  const count = Number.parseInt(field("NumMedia") || "0", 10) || 0;
  const media: TwilioInbound["media"] = [];
  for (let i = 0; i < count; i++) {
    const url = field(`MediaUrl${i}`);
    if (url) media.push({ url, contentType: field(`MediaContentType${i}`) });
  }
  return { from: field("From"), body: field("Body").trim(), messageSid: field("MessageSid") || null, media };
}

export async function toUserMessage(inbound: TwilioInbound, fetchMedia: MediaFetcher): Promise<ChatCompletionUserMessageParam> {
  const parts: ChatCompletionContentPart[] = [];
  if (inbound.body) parts.push({ type: "text", text: inbound.body });
  for (const item of inbound.media) {
    if (!item.contentType.startsWith("image/")) continue;
    const dataUrl = await fetchMedia(item.url);
    if (dataUrl) parts.push({ type: "image_url", image_url: { url: dataUrl } });
  }
  if (parts.length === 0) parts.push({ type: "text", text: "(no content)" });
  return { role: "user", content: parts };
}
```

- [ ] **Step 5: Implement the pipeline, webhook and simulator**

`apps/api/src/agent/pipeline.ts`:
```ts
import type { CareEvent } from "@careguard/shared";
import type { ChatCompletionUserMessageParam } from "openai/resources/chat/completions";
import type { Clock } from "../ports/clock.js";
import type { Llm } from "../ports/llm.js";
import type { Logger } from "../ports/logger.js";
import type { Messenger } from "../ports/messenger.js";
import type { Services } from "../services.js";
import { careguardSystemPrompt } from "./prompts/careguard.js";
import { runTurn } from "./runner.js";
import type { ToolSet } from "./tool.js";
import type { TurnQueue } from "./turn-queue.js";

export const FALLBACK_REPLY = "Maaf, ada masalah sikit. Cuba hantar sekali lagi ya.";

export interface InboundTurn {
  /** Twilio form: `whatsapp:+60…`. */
  phone: string;
  message: ChatCompletionUserMessageParam;
  externalId?: string | null;
  /** Where this turn's messages go: Twilio for real traffic, a CapturingMessenger for simulate/CLI. */
  messenger: Messenger;
  onToolCall?: (name: string, args: unknown) => void;
}

export interface InboundResult {
  status: "replied" | "duplicate" | "failed";
  reply: string | null;
  events: CareEvent[];
}

export interface InboundPipeline {
  handle(turn: InboundTurn): Promise<InboundResult>;
  idle(): Promise<void>;
}

export interface PipelineDeps {
  services: Services;
  tools: ToolSet;
  llm: Llm;
  queue: TurnQueue;
  clock: Clock;
  log: Logger;
  systemPrompt?: (now: Date) => string;
}

export function createInboundPipeline({
  services,
  tools,
  llm,
  queue,
  clock,
  log,
  systemPrompt = careguardSystemPrompt,
}: PipelineDeps): InboundPipeline {
  return {
    handle(turn) {
      const elder = services.elders.findOrCreateByPhone(turn.phone);

      return queue.run(elder.id, async (): Promise<InboundResult> => {
        // Persisted inside the queue so stored order matches turn order (spec §13.2).
        if (!services.conversation.appendInbound(elder.id, turn.message, turn.externalId)) {
          log.info("duplicate inbound message ignored", { elderId: elder.id, externalId: turn.externalId });
          return { status: "duplicate", reply: null, events: [] };
        }

        const startedAt = clock.now().toISOString();
        const history = services.conversation.window(elder.id);
        history[history.length - 1] = turn.message; // this turn sees the photo; stored history keeps "[photo]"

        try {
          const { reply, newMessages } = await runTurn({
            elder,
            system: systemPrompt(clock.now()),
            history,
            tools,
            llm,
            messenger: turn.messenger,
            clock,
            log,
            onToolCall: turn.onToolCall,
          });
          services.conversation.append(elder.id, newMessages);

          const body = reply.trim() || FALLBACK_REPLY;
          if (!(await turn.messenger.send({ to: elder.phone, body }))) log.warn("reply not delivered", { elderId: elder.id });
          return { status: "replied", reply: body, events: services.events.list({ elderId: elder.id, since: startedAt }) };
        } catch (err) {
          log.error("turn failed", { elderId: elder.id, error: err instanceof Error ? err.message : String(err) });
          await turn.messenger.send({ to: elder.phone, body: FALLBACK_REPLY });
          return { status: "failed", reply: FALLBACK_REPLY, events: [] };
        }
      });
    },
    idle: () => queue.idle(),
  };
}
```

`apps/api/src/channels/whatsapp/webhook.ts`:
```ts
import type { RequestHandler } from "express";
import type { MediaFetcher } from "../../adapters/twilio-media.js";
import type { InboundPipeline } from "../../agent/pipeline.js";
import type { Logger } from "../../ports/logger.js";
import type { Messenger } from "../../ports/messenger.js";
import { parseTwilioForm, toUserMessage } from "./inbound.js";
import { isValidTwilioSignature } from "./signature.js";

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface WhatsAppWebhookDeps {
  pipeline: Pick<InboundPipeline, "handle">;
  messenger: Messenger;
  fetchMedia: MediaFetcher;
  log: Logger;
  /** Omitted when TWILIO_AUTH_TOKEN or PUBLIC_URL is unset (never in production). */
  signature?: { authToken: string; publicUrl: string };
}

export function createWhatsAppWebhook({ pipeline, messenger, fetchMedia, log, signature }: WhatsAppWebhookDeps): RequestHandler {
  return (req, res) => {
    const form = (req.body ?? {}) as Record<string, string>;

    if (signature) {
      const url = new URL(req.originalUrl, signature.publicUrl).toString();
      if (!isValidTwilioSignature(signature.authToken, url, form, req.get("X-Twilio-Signature"))) {
        log.warn("rejected webhook with an invalid Twilio signature", { url });
        res.status(403).type("text/plain").send("Invalid signature");
        return;
      }
    }

    const inbound = parseTwilioForm(form);
    if (!inbound.from) {
      res.status(400).type("text/plain").send("Missing From");
      return;
    }

    // Acknowledge first: the agent can take longer than Twilio's ~15 s timeout.
    res.type("text/xml").send(EMPTY_TWIML);

    void (async () => {
      const message = await toUserMessage(inbound, fetchMedia);
      await pipeline.handle({ phone: inbound.from, message, externalId: inbound.messageSid, messenger });
    })().catch((err: unknown) => {
      log.error("webhook turn failed", { error: err instanceof Error ? err.message : String(err) });
    });
  };
}
```

`apps/api/src/channels/simulate.ts`:
```ts
import { SimulateRequest, type SimulateResponse } from "@careguard/shared";
import type { RequestHandler } from "express";
import { CapturingMessenger } from "../adapters/capturing-messenger.js";
import type { InboundPipeline } from "../agent/pipeline.js";
import { normalizePhone, toWhatsApp } from "../phone.js";

/** Runs a full WhatsApp turn without Twilio. Every outbound message is captured and returned, never sent. */
export function createSimulateHandler(pipeline: Pick<InboundPipeline, "handle">): RequestHandler {
  return async (req, res) => {
    const { phone, text } = SimulateRequest.parse(req.body);
    const messenger = new CapturingMessenger();
    const result = await pipeline.handle({
      phone: toWhatsApp(normalizePhone(phone) ?? phone),
      message: { role: "user", content: [{ type: "text", text }] },
      messenger,
    });
    res.json({ reply: result.reply, sent: messenger.sent, events: result.events } satisfies SimulateResponse);
  };
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run apps/api/src/agent/pipeline.test.ts apps/api/src/channels && npm run typecheck -w @careguard/api`
Expected: 24 tests PASS (signature 3, inbound 5, pipeline 9, webhook 5, simulate 2); `tsc` exits 0.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: every test in `shared` and `api` passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/agent/pipeline.ts apps/api/src/agent/pipeline.test.ts apps/api/src/channels apps/api/src/test/twilio-fixture.ts
git commit -m "feat(api): ack-then-process WhatsApp webhook with Twilio signatures, inbound pipeline, dev simulator"
```

---

### Task 11: Runtime composition, server entry point, demo seed and CLI

**Files:**
- Create: `apps/api/src/runtime.ts`, `apps/api/src/main.ts`, `apps/api/src/cli.ts`, `apps/api/src/load-env.ts`, `apps/api/src/infra/seed.ts`
- Test: `apps/api/src/runtime.test.ts`, `apps/api/src/infra/seed.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–10.
- Produces:
  - `interface Runtime { config: Config; log: Logger; db: Db; services: Services; pipeline: InboundPipeline; app: Express; close(): void }`, `createRuntime(config: Config, log: Logger): Runtime`
  - `DEMO_PHONE = "whatsapp:+60000000001"`, `seedDemo(services: Services): boolean`
  - `load-env.ts`: side-effect import that loads `apps/api/.env` then the repo-root `.env`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/infra/seed.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestServices } from "../test/harness.js";
import { DEMO_PHONE, seedDemo } from "./seed.js";

describe("seedDemo", () => {
  it("seeds an empty database exactly once", () => {
    const { services } = createTestServices();

    expect(seedDemo(services)).toBe(true);
    const [mak] = services.elders.list();
    expect(mak).toMatchObject({ phone: DEMO_PHONE, name: "Mak" });
    expect(services.events.list({ elderId: mak!.id }).map((e) => e.type).sort()).toEqual(["bill_explained", "scam_detected"]);

    expect(seedDemo(services)).toBe(false);
    expect(services.events.list()).toHaveLength(2);
  });

  it("leaves a database that already has elders alone", () => {
    const { services } = createTestServices();
    services.elders.findOrCreateByPhone("whatsapp:+60111111111");
    expect(seedDemo(services)).toBe(false);
    expect(services.events.list()).toEqual([]);
  });
});
```

`apps/api/src/runtime.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/api/src/runtime.test.ts apps/api/src/infra/seed.test.ts`
Expected: FAIL — `./runtime.js` and `./seed.js` not found.

- [ ] **Step 3: Implement the seed and runtime**

`apps/api/src/infra/seed.ts`:
```ts
import type { Services } from "../services.js";

export const DEMO_PHONE = "whatsapp:+60000000001";

/** Demo data for an empty database (SEED_DEMO=true). Returns false when anything already exists. */
export function seedDemo(services: Services): boolean {
  if (services.elders.list().length > 0) return false;

  const mak = services.elders.findOrCreateByPhone(DEMO_PHONE, "Mak");
  services.events.record({
    elderId: mak.id,
    type: "bill_explained",
    severity: "low",
    summary: "Explained a TNB electricity bill — RM143, due 25 Sep. Reminder set.",
    detail: { kind: "bill", amount: 143, due: "2026-09-25", example: true },
  });
  services.events.record({
    elderId: mak.id,
    type: "scam_detected",
    severity: "high",
    summary: "Likely scam — fake Maybank 'account suspended' message with a phishing link.",
    detail: {
      reasons: [
        "Asks for an OTP/TAC/password — real banks never do this",
        'Link maybank-verify.xyz: Mentions "maybank" but the link is maybank-verify.xyz, not an official maybank domain',
      ],
      example: true,
    },
  });
  return true;
}
```

`apps/api/src/runtime.ts`:
```ts
import type { Express } from "express";
import { createConsoleMessenger } from "./adapters/console-messenger.js";
import { createExaSearch } from "./adapters/exa-search.js";
import { createInProcessScheduler } from "./adapters/in-process-scheduler.js";
import { nullSearch } from "./adapters/null-search.js";
import { offlineUrlReputation } from "./adapters/offline-url-reputation.js";
import { createOpenAiLlm, disabledLlm } from "./adapters/openai-llm.js";
import { createSafeBrowsing } from "./adapters/safe-browsing.js";
import { systemClock } from "./adapters/system-clock.js";
import { createTwilioMediaFetcher, noMedia } from "./adapters/twilio-media.js";
import { createTwilioMessenger } from "./adapters/twilio-messenger.js";
import { createInboundPipeline, type InboundPipeline } from "./agent/pipeline.js";
import { buildTools } from "./agent/registry.js";
import { createTurnQueue } from "./agent/turn-queue.js";
import { createSimulateHandler } from "./channels/simulate.js";
import { createWhatsAppWebhook } from "./channels/whatsapp/webhook.js";
import { createApp } from "./http/app.js";
import type { Config } from "./infra/config.js";
import { openDb, type Db } from "./infra/db.js";
import type { Logger } from "./ports/logger.js";
import { createServices, type Services } from "./services.js";

export interface Runtime {
  config: Config;
  log: Logger;
  db: Db;
  services: Services;
  pipeline: InboundPipeline;
  app: Express;
  close(): void;
}

/** The composition root: picks a real adapter or its fallback for every port, based on config. */
export function createRuntime(config: Config, log: Logger): Runtime {
  const db = openDb(config.databasePath);
  const clock = systemClock;
  const messenger = config.twilio ? createTwilioMessenger(config.twilio, log) : createConsoleMessenger(log);
  const search = config.exaApiKey ? createExaSearch({ apiKey: config.exaApiKey }, log) : nullSearch;
  const urlReputation = config.safeBrowsingKey ? createSafeBrowsing({ apiKey: config.safeBrowsingKey }, log) : offlineUrlReputation;
  const llm = config.openai ? createOpenAiLlm({ ...config.openai, model: config.model }) : disabledLlm;

  const services = createServices({
    db,
    clock,
    log,
    messenger,
    scheduler: createInProcessScheduler(clock, log),
    search,
    urlReputation,
  });
  const pipeline = createInboundPipeline({
    services,
    tools: buildTools({ ...services, search }),
    llm,
    queue: createTurnQueue(),
    clock,
    log,
  });

  const app = createApp({
    config,
    log,
    services,
    checkDb: () => {
      try {
        db.prepare("SELECT 1").get();
        return true;
      } catch {
        return false;
      }
    },
    whatsappWebhook: createWhatsAppWebhook({
      pipeline,
      messenger,
      fetchMedia: config.twilio ? createTwilioMediaFetcher(config.twilio, log) : noMedia,
      log,
      signature:
        config.twilio && config.publicUrl ? { authToken: config.twilio.authToken, publicUrl: config.publicUrl } : undefined,
    }),
    simulate: createSimulateHandler(pipeline),
  });

  return { config, log, db, services, pipeline, app, close: () => db.close() };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run apps/api/src/runtime.test.ts apps/api/src/infra/seed.test.ts && npm run typecheck -w @careguard/api`
Expected: 4 tests PASS; `tsc` exits 0.

- [ ] **Step 5: Implement the entry points**

These are thin wiring over tested code; they are verified by running them in Steps 6–7.

`apps/api/src/load-env.ts`:
```ts
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// npm workspaces run scripts from apps/api, so look there first, then at the repo root.
// Real environment variables always win (dotenv never overrides them).
const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: [join(apiRoot, ".env"), join(apiRoot, "..", "..", ".env")], quiet: true });
```

`apps/api/src/main.ts`:
```ts
import "./load-env.js";
import { createConsoleLogger } from "./adapters/console-logger.js";
import { ConfigError, loadConfig, type Config } from "./infra/config.js";
import { seedDemo } from "./infra/seed.js";
import { createRuntime } from "./runtime.js";

const log = createConsoleLogger();

function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const config = loadConfigOrExit();
const runtime = createRuntime(config, log);

if (config.seedDemo && seedDemo(runtime.services)) log.info("seeded demo data");
const restoredReminders = runtime.services.reminders.restorePending();

const server = runtime.app.listen(config.port, () => {
  log.info("CareGuard API listening", { port: config.port, env: config.env, fallbacks: config.fallbacks, restoredReminders });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down", { signal });
  server.close();
  await Promise.race([runtime.pipeline.idle(), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  server.closeAllConnections(); // open SSE streams would otherwise keep the process alive
  runtime.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

`apps/api/src/cli.ts`:
```ts
import "./load-env.js";
import * as readline from "node:readline";
import { CapturingMessenger } from "./adapters/capturing-messenger.js";
import { createConsoleLogger } from "./adapters/console-logger.js";
import { loadConfig } from "./infra/config.js";
import { createRuntime } from "./runtime.js";

const CLI_PHONE = "whatsapp:+60000000000";

const config = loadConfig({ ...process.env, NODE_ENV: "development" });
const runtime = createRuntime(config, createConsoleLogger({ minLevel: "warn" }));

console.log(`CareGuard CLI — chatting as ${CLI_PHONE}. Ctrl+D to quit.`);
if (config.fallbacks.length > 0) console.log(`Fallbacks active: ${config.fallbacks.join(", ")}`);

const rl = readline.createInterface({ input: process.stdin });
process.stdout.write("\nyou › ");

for await (const line of rl) {
  const text = line.trim();
  if (text) {
    // Nothing is sent from the CLI: replies and family alerts are captured and printed.
    const messenger = new CapturingMessenger();
    const result = await runtime.pipeline.handle({
      phone: CLI_PHONE,
      message: { role: "user", content: [{ type: "text", text }] },
      messenger,
      onToolCall: (name) => console.log(`   …using ${name}`),
    });
    for (const message of messenger.sent) {
      if (message.to === CLI_PHONE) console.log(`\ncareguard › ${message.body}`);
      else console.log(`   ↗ WhatsApp to ${message.to}: ${message.body}`);
    }
    for (const event of result.events) console.log(`   • [${event.severity}] ${event.type}: ${event.summary}`);
  }
  process.stdout.write("\nyou › ");
}

runtime.close();
```

- [ ] **Step 6: Smoke-test the server with no keys**

Confirm there is no `.env` at the repo root or in `apps/api` (`ls .env apps/api/.env` → both "No such file"). If one exists, the reply below will differ — that is fine, but note it.

Run in the background:
`DATABASE_PATH="$(mktemp -d)/careguard.db" SEED_DEMO=true PORT=8799 npm run start -w @careguard/api`

Then:
```bash
curl -s localhost:8799/health
curl -s localhost:8799/api/events
curl -s -X POST localhost:8799/dev/simulate -H 'content-type: application/json' -d '{"phone":"+60123456789","text":"Hai"}'
```
Expected:
- the startup log line `CareGuard API listening` lists the five fallbacks;
- `/health` → `{"ok":true,"db":true,"fallbacks":[…5 items…]}`;
- `/api/events` → two events for elder "Mak" (`bill_explained`, `scam_detected`);
- `/dev/simulate` → `"reply":"Maaf, ada masalah sikit. Cuba hantar sekali lagi ya."`.

Stop the server with SIGTERM (`kill <pid>`). Expected: a `shutting down` log line and a clean exit.

- [ ] **Step 7: Smoke-test the CLI**

Run: `printf 'Hai\n' | npm run cli`
Expected: the banner, `Fallbacks active: …`, then `careguard › Maaf, ada masalah sikit. Cuba hantar sekali lagi ya.`, and the process exits on its own. This writes `apps/api/data/careguard.db`, which `.gitignore` excludes.

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass; every workspace typechecks.

```bash
git add apps/api/src/runtime.ts apps/api/src/runtime.test.ts apps/api/src/main.ts apps/api/src/cli.ts apps/api/src/load-env.ts apps/api/src/infra/seed.ts apps/api/src/infra/seed.test.ts
git commit -m "feat(api): runtime composition root, server entry with graceful shutdown, demo seed, CLI"
```

---

### Task 12: Dashboard shell

**Files:**
- Create: `apps/dashboard/package.json`, `apps/dashboard/next.config.ts`, `apps/dashboard/tsconfig.json`, `apps/dashboard/app/layout.tsx`, `apps/dashboard/app/page.tsx`, `apps/dashboard/lib/api.ts`

**Interfaces:**
- Consumes: `CareEvent`, `EventListResponse`, `ListEventsQuery` types from `@careguard/shared`; `GET /api/events` from Task 9.
- Produces: `API_URL: string`, `listEvents(query?: ListEventsQuery): Promise<CareEvent[]>` in `apps/dashboard/lib/api.ts`. No styling, CopilotKit or auth — those are event-day work.

No unit tests: the shell has no logic beyond one fetch. It is verified by typecheck, `next build`, and rendering against the running API.

- [ ] **Step 1: Create the Next.js app**

`apps/dashboard/package.json`:
```json
{
  "name": "@careguard/dashboard",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@careguard/shared": "*",
    "next": "^16.3.5",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0"
  }
}
```

`apps/dashboard/next.config.ts`:
```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  // @careguard/shared ships TypeScript source, not a build.
  transpilePackages: ["@careguard/shared"],
};

export default config;
```

`apps/dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/dashboard/lib/api.ts`:
```ts
import type { CareEvent, EventListResponse, ListEventsQuery } from "@careguard/shared";

export const API_URL = process.env.API_URL ?? "http://localhost:8787";

export async function listEvents(query: ListEventsQuery = {}): Promise<CareEvent[]> {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const res = await fetch(`${API_URL}/api/events?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API responded ${res.status}`);
  return ((await res.json()) as EventListResponse).events;
}
```

`apps/dashboard/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export const metadata = { title: "CareGuard — Family" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`apps/dashboard/app/page.tsx`:
```tsx
import type { CareEvent } from "@careguard/shared";
import { API_URL, listEvents } from "../lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  let events: CareEvent[] = [];
  let error: string | null = null;
  try {
    events = await listEvents();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main>
      <h1>CareGuard — family dashboard (shell)</h1>
      {error ? (
        <p>
          Could not reach the API at {API_URL}: {error}
        </p>
      ) : events.length === 0 ? (
        <p>No events yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              [{event.severity}] {event.type} — {event.summary} ({event.status})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Install, typecheck and build**

Run: `npm install && npm run typecheck -w @careguard/dashboard && npm run build:dashboard`
Expected: install completes; `tsc` exits 0; `next build` ends with a route table listing `ƒ /` (dynamic). If `next build` rewrites `apps/dashboard/tsconfig.json`, keep its changes and re-run the typecheck.

- [ ] **Step 3: Render against the running API**

Run in the background: `DATABASE_PATH="$(mktemp -d)/careguard.db" SEED_DEMO=true npm run start -w @careguard/api`
Run in the background: `npm run dev:dashboard`
Then: `curl -s localhost:3000 | grep -o "Likely scam[^<]*"`
Expected: the seeded scam summary appears. Stop both processes.

- [ ] **Step 4: Run the root checks and commit**

Run: `npm run typecheck && npm test`
Expected: all workspaces typecheck; all tests pass.

```bash
git add apps/dashboard/package.json apps/dashboard/next.config.ts apps/dashboard/tsconfig.json apps/dashboard/app apps/dashboard/lib package-lock.json
git commit -m "feat(dashboard): Next.js shell rendering the Events API with shared types"
```

---

### Task 13: Remove legacy code; Docker, CI, env example, docs

**Files:**
- Delete: `src/` (entire legacy starter), `tsconfig.json` (root)
- Modify: `Dockerfile` (replace), `.env.example` (replace), `README.md`, `CLAUDE.md`
- Create: `.dockerignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the finished `apps/api`, `apps/dashboard`, `packages/shared`.
- Produces: a deployable API image and CI that runs typecheck, tests and the dashboard build.

- [ ] **Step 1: Delete the legacy starter**

Confirm nothing new references it: `grep -rn "src/surfaces\|src/agent/scam\|src/agent/iphone" apps packages --include=*.ts --include=*.tsx`
Expected: no output.

```bash
git rm -r -q src tsconfig.json
```

Run: `npm run typecheck && npm test`
Expected: still green.

- [ ] **Step 2: Replace the Dockerfile and add `.dockerignore`**

`Dockerfile`:
```dockerfile
# CareGuard API — Google Cloud Run
#   gcloud run deploy careguard-api --source . --no-cpu-throttling --max-instances=1 --allow-unauthenticated \
#     --set-env-vars NODE_ENV=production,PUBLIC_URL=https://<service-url>,SEED_DEMO=true,OPENAI_API_KEY=...,\
#       TWILIO_ACCOUNT_SID=...,TWILIO_AUTH_TOKEN=...,TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# --no-cpu-throttling: turns keep running after the webhook has responded.
# --max-instances=1:   SQLite lives on this instance's (ephemeral) disk.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --omit=dev --workspace @careguard/api --workspace @careguard/shared

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/app/data/careguard.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
EXPOSE 8080
WORKDIR /app/apps/api
CMD ["/app/node_modules/.bin/tsx", "src/main.ts"]
```

`.dockerignore`:
```
**/node_modules
**/.next
**/data
**/*.db
**/.env
**/.env.local
.git
docs
apps/dashboard/*
!apps/dashboard/package.json
```

- [ ] **Step 3: Verify the image**

Run: `docker build -t careguard-api .`
Expected: build succeeds (`better-sqlite3` installs from its linux prebuild; no compiler needed).

Run: `docker run --rm careguard-api; echo "exit=$?"`
Expected: a JSON log line containing `Missing required production settings: OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, PUBLIC_URL` and `exit=1`.

Run:
```bash
docker run -d --rm -p 8080:8080 -e NODE_ENV=development -e SEED_DEMO=true --name careguard-smoke careguard-api
curl -s --retry 15 --retry-connrefused --retry-delay 1 localhost:8080/health
curl -s localhost:8080/api/events
docker rm -f careguard-smoke
```
Expected: `/health` returns `"ok":true` with five fallbacks; `/api/events` returns the two seeded events.

If the container fails with `Cannot find module`, a dependency was installed under `apps/api/node_modules` instead of being hoisted: add `COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules` after the root `node_modules` copy (create the directory in the deps stage with `RUN mkdir -p apps/api/node_modules` before `npm ci`) and rebuild.

- [ ] **Step 4: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build:dashboard
```

- [ ] **Step 5: Replace `.env.example`**

```bash
# CareGuard configuration. Copy to .env at the repo root.
# The API boots with none of these set: each missing key switches on a fallback,
# listed in the startup log and on GET /health. In production, OPENAI_API_KEY,
# the three TWILIO_* values and PUBLIC_URL are required.

# ---- Runtime ----------------------------------------------------------------
PORT=8787
DATABASE_PATH=./data/careguard.db
DASHBOARD_ORIGIN=http://localhost:3000
# Load demo elder "Mak" and two example events into an empty database
SEED_DEMO=false

# ---- Model --------------------------------------------------------------------
OPENAI_API_KEY=
MODEL=gpt-4o-mini
# OpenRouter instead of OpenAI:
# OPENAI_BASE_URL=https://openrouter.ai/api/v1
# MODEL=openai/gpt-4o-mini

# ---- WhatsApp via Twilio ------------------------------------------------------
# Twilio console -> Messaging -> Try it out -> WhatsApp sandbox
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
# The public origin Twilio calls (ngrok or Cloud Run), e.g. https://abc123.ngrok.app
# Required to verify Twilio signatures.
PUBLIC_URL=

# ---- Investigation (optional) -----------------------------------------------
# https://dashboard.exa.ai
EXA_API_KEY=
# https://developers.google.com/safe-browsing/v4/get-started
GOOGLE_SAFE_BROWSING_KEY=

# ---- Dashboard ----------------------------------------------------------------
# Read by apps/dashboard (put it in apps/dashboard/.env.local if it differs from the default)
API_URL=http://localhost:8787
```

- [ ] **Step 6: Update `README.md`**

Make these edits; leave every other line of the brief untouched.

1. In §4, replace `` (`src/surfaces/careguard.ts`) `` with `` (`apps/api/src/agent/prompts/careguard.ts`) ``.

2. In §5, replace the block from `### Data model (in \`src/agent/events.ts\`…` through the line starting `- To add:` with:
```markdown
### Data model (SQLite — `apps/api/src/infra/migrations/001_init.sql`)
- `events`: id, elderId, type (`bill_explained` | `scam_detected` | `high_risk_action`
  | `reminder_created`), severity (`low` | `med` | `high`), summary, detail, status
  (`new` | `approved` | `dismissed` | `resolved`), createdAt, resolvedAt, resolvedBy. **This is the spine both surfaces share.**
- `elders` (keyed by WhatsApp number), `family_members` (`auth0_sub` reserved for Auth0), `reminders`,
  and `messages` (conversation history).
```

3. In §6, replace the `### Already scaffolded …` heading and its bullet list (through the `src/surfaces/cli.ts` bullet) with:
```markdown
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
```

4. In the "Build live" list: replace `` (`/dashboard`, Next.js) `` with `` (`apps/dashboard`, Next.js) ``; replace `(currently in-memory only)` with `(currently an in-process scheduler behind the \`Scheduler\` port)`; replace the two-line **Wire approval → action** item with:
```markdown
- [x] **Wire approval → action** (foundation): approving a scam event sends the elder a reassurance —
      tune its wording in `apps/api/src/modules/events/service.ts`.
```
   and replace `` tune the prompt in `careguard.ts` `` with `` tune the prompt in `apps/api/src/agent/prompts/careguard.ts` ``.

5. Delete the `### Ignore / delete …` heading, its two bullet lines, and the blank line after them.

6. In §7, replace the three Track bullets with:
```markdown
- **Track A — WhatsApp + agent** (`apps/api/src/agent`, `modules/protect`, `modules/reminders`): get
  forward→verdict→event working end to end; refine the communication layer.
- **Track B — CopilotKit dashboard** (`apps/dashboard`): Auth0 + events feed + approve + live stream +
  copilot Q&A. *Highest-value new build.*
- **Track C — backend + deploy** (`apps/api/src/http`, `modules/events`, Trigger.dev): keep the Events API
  solid, wire Trigger.dev, deploy both to Cloud Run.
```

7. Replace all of §10 (from `## 10. Run & setup` up to, not including, the `---` line before `## 11.`) with:

~~~markdown
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
~~~

- [ ] **Step 7: Update `CLAUDE.md`**

1. Replace `` system prompt in `src/surfaces/careguard.ts` `` with `` system prompt in `apps/api/src/agent/prompts/careguard.ts` ``.

2. Replace the five bullets under `## Build live …` with:
```markdown
- The CopilotKit dashboard in `apps/dashboard` (Next.js) against the Events API
  (`apps/api/src/modules/events/routes.ts`; live updates on `GET /api/stream`).
- Auth0 login + implement `apps/api/src/http/require-family.ts` (gates `/api/events/:id/approve`).
- Trigger.dev: a `Scheduler` adapter so `create_reminder` nudges survive restarts.
- Tune the approval reassurance (`apps/api/src/modules/events/service.ts`) and the prompt.
- Deploy backend + dashboard to Cloud Run.
```

3. Replace `- Verify with \`npm run typecheck\` and \`npm run cli\` as you go.` with `- Verify with \`npm test\`, \`npm run typecheck\` and \`npm run cli\` as you go.`

4. Replace the final `## Run` section (heading and its two lines) with:
```markdown
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
```

- [ ] **Step 8: Final verification**

Run: `npm run typecheck && npm test && npm run build:dashboard`
Expected: all green.

Run: `grep -rn "src/surfaces\|npm run careguard\|npm run server" README.md CLAUDE.md .env.example`
Expected: no output.

Run: `git status --short`
Expected: only the files listed in this task. Generated files (`apps/dashboard/next-env.d.ts`, `.next/`, `data/`) must not appear — they are git-ignored.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile .dockerignore .github/workflows/ci.yml .env.example README.md CLAUDE.md
git commit -m "chore: remove legacy starter; Docker image, CI, env example and docs for the new layout"
```

(The `git rm` in Step 1 is already staged and is included in this commit.)

---

## Done when

- `npm run typecheck`, `npm test` and `npm run build:dashboard` pass on `feature/architecture`.
- `docker build` succeeds; the container refuses to start in production without keys and serves `/health` in development.
- `printf 'Hai\n' | npm run cli` prints the fallback reply with no keys configured.
- `git log --oneline main..feature/architecture` shows the spec commit plus one commit per task (13).
- Nothing is pushed. Event-day work starts on a new branch `feature/careguard-core` (uncommitted, per the agreed split).

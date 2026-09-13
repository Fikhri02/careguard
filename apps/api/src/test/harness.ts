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

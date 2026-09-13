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

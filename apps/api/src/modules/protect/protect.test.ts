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
    expect(result.reasons).toContain(
      'Link maybank-verify.xyz: Mentions "maybank" but the link is maybank-verify.xyz, not an official maybank domain',
    );
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
    const events = createEventsService({
      repo: createEventsRepo(db),
      bus: createEventBus(),
      messenger: new CapturingMessenger(),
      elders,
      clock,
      log: silentLogger,
    });
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

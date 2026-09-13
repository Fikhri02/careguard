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

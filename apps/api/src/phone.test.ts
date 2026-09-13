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

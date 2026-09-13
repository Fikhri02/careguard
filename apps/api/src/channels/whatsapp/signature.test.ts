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

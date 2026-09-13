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

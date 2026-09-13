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

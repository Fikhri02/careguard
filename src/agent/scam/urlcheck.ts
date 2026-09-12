// URL risk analysis — the most demoable "real investigation" signal.
// 1) Google Safe Browsing (free API) if a key is set.
// 2) Lookalike-domain heuristic: a message that name-drops a MY bank/agency
//    but links to a domain that ISN'T the official one is a classic phish.
// 3) Cheap structural red flags (shorteners, raw IP, punycode, non-.my gov).

// Official domains that legit MY bank / gov messages would actually use.
const OFFICIAL: Record<string, string[]> = {
  maybank: ["maybank2u.com.my", "maybank.com.my"],
  cimb: ["cimbclicks.com.my", "cimb.com.my"],
  publicbank: ["pbebank.com", "publicbank.com.my"],
  rhb: ["rhbgroup.com", "rhb.com.my"],
  hongleong: ["hongleongconnect.my", "hlb.com.my"],
  bankislam: ["bankislam.com", "bankislam.com.my"],
  bnm: ["bnm.gov.my"],
  lhdn: ["hasil.gov.my"],
  jpj: ["jpj.gov.my", "myeg.com.my"],
  pos: ["pos.com.my"],
  tng: ["touchngo.com.my", "tngdigital.com.my"],
};

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "rebrand.ly", "shorturl.at"];

export interface UrlFinding {
  url: string;
  host: string;
  flags: string[];
  suspicious: boolean;
}

export async function checkUrl(rawUrl: string, messageText = ""): Promise<UrlFinding> {
  const flags: string[] = [];
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { url: rawUrl, host: rawUrl, flags: ["Not a valid URL"], suspicious: true };
  }

  // Structural red flags
  if (SHORTENERS.some((s) => host.endsWith(s))) flags.push("Uses a link shortener (hides the real destination)");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push("Links to a raw IP address, not a domain");
  if (host.startsWith("xn--") || host.includes(".xn--")) flags.push("Uses punycode (can disguise a fake domain)");

  // Lookalike-brand heuristic
  const haystack = (messageText + " " + host).toLowerCase();
  for (const [brand, domains] of Object.entries(OFFICIAL)) {
    if (haystack.includes(brand)) {
      const legit = domains.some((d) => host === d || host.endsWith("." + d));
      if (!legit) {
        flags.push(`Mentions "${brand}" but the link is ${host}, not an official ${brand} domain`);
      }
    }
  }

  // Google Safe Browsing (real, free) — degrades gracefully with no key.
  const gsb = await safeBrowsing(rawUrl);
  if (gsb === true) flags.push("Flagged by Google Safe Browsing as unsafe");

  return { url: rawUrl, host, flags, suspicious: flags.length > 0 };
}

async function safeBrowsing(url: string): Promise<boolean | null> {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "scam-guardian", clientVersion: "1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { matches?: unknown[] };
    return Array.isArray(data.matches) && data.matches.length > 0;
  } catch {
    return null;
  }
}

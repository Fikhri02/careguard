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
        findings.some((f) => f.suspicious) || patternReasons.length >= 2
          ? "HIGH"
          : patternReasons.length === 1
            ? "MEDIUM"
            : "LOW";

      return { risk, reasons: [...patternReasons, ...urlReasons], webNote };
    },
  };
}

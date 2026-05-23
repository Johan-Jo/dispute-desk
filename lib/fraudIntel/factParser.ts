/**
 * Parser for Shopify pre-authorization risk fact strings.
 *
 * Shopify returns ~10 distinct signal types as English-language fact
 * descriptions tagged POSITIVE / NEUTRAL / NEGATIVE. We can't usefully
 * query "did proxy detection predict chargebacks?" against a free-text
 * column, so this parser breaks the strings into typed signals.
 *
 * Architectural contracts (load-bearing):
 *   1. Structured-from-GraphQL fields (AVS / CVV / BIN / brand /
 *      wallet, clientIp) ALWAYS win over parser output. The parser
 *      fills only what the schema doesn't expose: proxy detection,
 *      payment-attempt count, IP↔ship distance, fraud-cluster match,
 *      billing-country-matches-IP, multiple-cards-tried.
 *   2. Regex tuples are (sentiment, regex) — anchoring on the expected
 *      sentiment reduces false matches (a fact tagged POSITIVE for
 *      "billing zip matches" should never match a NEGATIVE "billing
 *      zip mismatch" template).
 *   3. Parser is PURE. Zero IO. Never throws. Unknown phrasing →
 *      misses array; the writer flushes those to fraud_intel_parse_misses
 *      so we can monitor drift when Shopify rewords a signal.
 *   4. parser_version is exported as a constant. Bump on every regex
 *      change; the writer persists it on shopify_order_risk_signals so
 *      future analytics can dis-aggregate by parser revision.
 *   5. The English locale is pinned at the call site (lib/shopify/graphql.ts
 *      via locale: "en" — see PR-C). The parser is built against
 *      English-only phrasing and would silently fail on localized
 *      strings if the pin was removed.
 */

export const PARSER_VERSION = 1;

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

export interface RawFact {
  description: string | null;
  sentiment: string | null;
}

export interface ParsedSignals {
  payment_attempt_count: number | null;
  proxy_detected: boolean | null;
  multiple_cards_tried: boolean | null;
  billing_country_matches_ip: boolean | null;
  ip_country: string | null;
  ip_ship_distance_km: number | null;
  fraud_cluster_match: boolean | null;
}

export interface ParseMiss {
  text: string;
  sentiment: Sentiment | null;
}

export interface ParseResult {
  signals: ParsedSignals;
  misses: ParseMiss[];
}

const EMPTY_SIGNALS: ParsedSignals = {
  payment_attempt_count: null,
  proxy_detected: null,
  multiple_cards_tried: null,
  billing_country_matches_ip: null,
  ip_country: null,
  ip_ship_distance_km: null,
  fraud_cluster_match: null,
};

/** A single parse rule. `apply` runs against the (lowercase-trimmed)
 *  description and returns either a partial ParsedSignals update or
 *  null when the rule doesn't match. */
interface ParseRule {
  /** Required sentiment for the rule to apply. Null = any sentiment. */
  sentiment: Sentiment | null;
  /** Regex to test against the trimmed description. */
  regex: RegExp;
  apply: (match: RegExpExecArray) => Partial<ParsedSignals>;
}

/** Normalize a sentiment to the canonical enum. Null on missing/invalid. */
function normalizeSentiment(raw: string | null | undefined): Sentiment | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "POSITIVE" || upper === "NEUTRAL" || upper === "NEGATIVE") {
    return upper;
  }
  return null;
}

/** Anchored rule set. English-only — locale pin is enforced at the
 *  Shopify call site (locale: "en"). */
const RULES: ParseRule[] = [
  // Proxy / VPN / Tor / anonymous IP — Shopify uses several phrasings.
  {
    sentiment: "NEGATIVE",
    regex: /\b(proxy|vpn|tor|anonymous(?:\s+ip)?|anonymizer)\b/i,
    apply: () => ({ proxy_detected: true }),
  },
  {
    sentiment: "POSITIVE",
    regex: /\b(?:no|not(?:\s+detected)?|did\s+not\s+(?:use|originate))\b.*\b(?:proxy|vpn|tor|anonymous)\b/i,
    apply: () => ({ proxy_detected: false }),
  },

  // Multiple cards tried — "Customer used N different credit cards" /
  // "Multiple payment methods used".
  {
    sentiment: "NEGATIVE",
    regex: /\b(?:multiple|several|\d+)\s+(?:different\s+)?(?:credit\s+)?(?:cards?|payment\s+methods?)\b/i,
    apply: () => ({ multiple_cards_tried: true }),
  },

  // Payment-attempt count — "N attempt(s) to charge".
  {
    sentiment: null,
    regex: /\b(\d+)\s+(?:payment\s+)?attempts?\s+(?:to\s+)?charge\b/i,
    apply: (m) => {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) ? { payment_attempt_count: n } : {};
    },
  },
  // Variant: "Customer attempted to pay N times".
  {
    sentiment: null,
    regex: /\battempted\s+(?:to\s+pay|payment)\s+(\d+)\s+times?\b/i,
    apply: (m) => {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) ? { payment_attempt_count: n } : {};
    },
  },

  // Billing country matches IP geolocation country.
  {
    sentiment: "POSITIVE",
    regex: /\bbilling\s+(?:address\s+)?country\s+(?:matches|same\s+as)\s+(?:the\s+)?ip\b/i,
    apply: () => ({ billing_country_matches_ip: true }),
  },
  {
    sentiment: "NEGATIVE",
    regex: /\bbilling\s+(?:address\s+)?country\s+(?:doesn'?t\s+match|differs?\s+from|is\s+different\s+from)\s+(?:the\s+)?ip\b/i,
    apply: () => ({ billing_country_matches_ip: false }),
  },

  // IP geolocation country — captures the 2-letter or country name.
  // Case-insensitive so "IP located in NL" and "ip located in NL" both
  // match. The captured country may be 2-letter caps (ISO) or a name
  // (e.g. "Netherlands"). Downstream queries normalize.
  {
    sentiment: null,
    regex: /\b(?:ip\s+(?:address\s+)?(?:located|originat(?:es?|ing))\s+(?:in|from)\s+|customer\s+ip\s+(?:is\s+)?in\s+)([A-Za-z]{2,40}(?:\s+[A-Za-z]{2,40})?)\b/i,
    apply: (m) => {
      const c = m[1].trim();
      return c ? { ip_country: c } : {};
    },
  },

  // Distance between IP geo and shipping address.
  {
    sentiment: null,
    regex: /\b(\d{1,5}(?:,\d{3})*)\s*km\b.*(?:between\s+the?\s+)?(?:ip|customer)\s+(?:and|to)\s+(?:shipping|delivery)/i,
    apply: (m) => {
      const km = parseInt(m[1].replace(/,/g, ""), 10);
      return Number.isFinite(km) ? { ip_ship_distance_km: km } : {};
    },
  },
  {
    sentiment: null,
    regex: /\bshipping\s+address\s+is\s+(\d{1,5}(?:,\d{3})*)\s*km\s+(?:from|away\s+from)\s+(?:the\s+)?(?:customer(?:'?s)?\s+)?ip\b/i,
    apply: (m) => {
      const km = parseInt(m[1].replace(/,/g, ""), 10);
      return Number.isFinite(km) ? { ip_ship_distance_km: km } : {};
    },
  },

  // Fraud cluster / pattern match.
  {
    sentiment: "NEGATIVE",
    regex: /\b(?:fraud(?:ulent)?\s+(?:cluster|pattern|network)|matches?\s+(?:a\s+)?(?:known\s+)?fraud(?:ulent)?\s+pattern|associated\s+with\s+(?:known\s+)?fraud)/i,
    apply: () => ({ fraud_cluster_match: true }),
  },
  {
    sentiment: "POSITIVE",
    regex: /\b(?:no\s+(?:fraud(?:ulent)?\s+)?(?:cluster|pattern)\s+match|order\s+(?:does\s+not|doesn'?t)\s+match\s+(?:known\s+)?fraud)/i,
    apply: () => ({ fraud_cluster_match: false }),
  },
];

/**
 * Pure parser. Returns the structured signal set + a list of unmatched
 * fact strings for ops monitoring.
 *
 * Sentiment-gated: a rule's regex is checked ONLY when the fact's
 * sentiment matches the rule's expected sentiment (or the rule is
 * sentiment-agnostic). Anchoring on sentiment cuts the false-match
 * rate for negation phrasings.
 */
export function parseRiskFacts(facts: RawFact[] | null | undefined): ParseResult {
  if (!facts || facts.length === 0) {
    return { signals: { ...EMPTY_SIGNALS }, misses: [] };
  }
  const signals: ParsedSignals = { ...EMPTY_SIGNALS };
  const misses: ParseMiss[] = [];

  for (const fact of facts) {
    const text = (fact?.description ?? "").trim();
    if (!text) continue;
    const sentiment = normalizeSentiment(fact?.sentiment);

    let matched = false;
    for (const rule of RULES) {
      if (rule.sentiment !== null && rule.sentiment !== sentiment) continue;
      const m = rule.regex.exec(text);
      if (m) {
        const update = rule.apply(m);
        for (const [k, v] of Object.entries(update)) {
          // Don't clobber a non-null signal with a later rule's null;
          // first concrete value wins. (Rules ordered most-specific
          // first within each category.)
          const key = k as keyof ParsedSignals;
          if (signals[key] === null && v !== undefined && v !== null) {
            (signals as unknown as Record<string, unknown>)[key] = v;
          }
        }
        matched = true;
        // Don't break — a single string can carry multiple signals
        // (e.g. "IP located in NL, 8,400 km from shipping address").
      }
    }

    if (!matched) {
      misses.push({ text, sentiment });
    }
  }

  return { signals, misses };
}

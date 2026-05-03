/**
 * Shared rule helpers used by both surfaces (Phase 3.3).
 *
 * The embedded (`app/(embedded)/app/rules/page.tsx`) and portal
 * (`app/(portal)/portal/rules/page.tsx`) rules pages diverged
 * intentionally on UI primitives (Polaris vs Tailwind), but the
 * mapping tables and the human-readable match summary are pure
 * data + format logic that should live in one place.
 */

/**
 * Family slug → dispute-type code used by the rule engine + the
 * pack template installer. Drives the install-modal's initial
 * category and the `?family=...` deep links from the coverage page.
 */
export const FAMILY_TO_DISPUTE_TYPE: Record<string, string> = {
  fraud: "FRAUD",
  pnr: "PNR",
  not_as_described: "NOT_AS_DESCRIBED",
  subscription: "SUBSCRIPTION",
  refund: "REFUND",
  duplicate: "DUPLICATE",
  general: "GENERAL",
};

/**
 * Shopify dispute-reason code → i18n key under the `reasons.*`
 * namespace. The list mirrors `DISPUTE_REASONS` in the portal
 * rules page; any new reason needs both the constant + a key.
 */
export const REASON_KEYS: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "productNotReceived",
  PRODUCT_UNACCEPTABLE: "productUnacceptable",
  FRAUDULENT: "fraudulent",
  CREDIT_NOT_PROCESSED: "creditNotProcessed",
  SUBSCRIPTION_CANCELED: "subscriptionCanceled",
  DUPLICATE: "duplicate",
  GENERAL: "general",
};

/** Match shape used by both rules pages. Subset of the full Rule
 *  row shape; only the parts `matchSummary` reads. */
export interface RuleMatch {
  reason?: string[];
  status?: string[];
  amount_range?: { min?: number; max?: number };
}

/**
 * `useTranslations()` return shape: callable with a key, plus a
 * `.has(key)` discriminator. Mirrors next-intl's exposed API
 * surface so callers can pass the result directly without an
 * `as any`.
 */
export interface ReasonsTranslator {
  (key: string): string;
  has(key: string): boolean;
}

export type MessageTranslator = (key: string) => string;

/**
 * Render a rule's `match` object as a human-readable single line
 * suitable for a per-rule subtitle. Examples:
 *
 *   "Reason: Fraudulent · Status: open · ≥ $500"
 *   "Matches all"
 *
 * Returns the localized "Matches all" string when the match
 * object has no constraints. Reason codes that don't appear in
 * `REASON_KEYS` (or whose key isn't present in the loaded
 * locale) fall back to `r.replace(/_/g, " ")` — the same lossy
 * fallback the inline copies used.
 */
export function matchSummary(
  match: RuleMatch,
  tRules: MessageTranslator,
  tReasons: ReasonsTranslator,
): string {
  const parts: string[] = [];
  if (match.reason?.length) {
    const translated = match.reason.map((r) => {
      const key = REASON_KEYS[r];
      return key && tReasons.has(key) ? tReasons(key) : r.replace(/_/g, " ");
    });
    parts.push(`${tRules("reason")}: ${translated.join(", ")}`);
  }
  if (match.status?.length) {
    parts.push(`${tRules("statusLabel")}: ${match.status.join(", ")}`);
  }
  if (match.amount_range) {
    const { min, max } = match.amount_range;
    if (min != null && max != null) parts.push(`$${min}–$${max}`);
    else if (min != null) parts.push(`≥ $${min}`);
    else if (max != null) parts.push(`≤ $${max}`);
  }
  return parts.length ? parts.join(" · ") : tRules("matchesAll");
}

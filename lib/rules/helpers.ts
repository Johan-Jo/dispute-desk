/**
 * Shared rule helpers used by both surfaces (Phase 3.3).
 *
 * The embedded (`app/(embedded)/app/rules/page.tsx`) and portal
 * (`app/(portal)/portal/rules/page.tsx`) rules pages diverged
 * intentionally on UI primitives (Polaris vs Tailwind), but the
 * mapping tables and the human-readable match summary are pure
 * data + format logic that should live in one place.
 */

import { canonicalReasonCode } from "./disputeReasons";

/**
 * Family slug → dispute-type code used by the rule engine + the
 * pack template installer. Drives the install-modal's initial
 * category and the `?family=...` deep links from the coverage page.
 *
 * The values MUST be the canonical `pack_templates.dispute_type`
 * codes (the Shopify reason codes, since migration 20260411160000)
 * — the template library filters on `.eq("dispute_type", …)`, so a
 * short alias like "FRAUD"/"REFUND" would match zero rows and the
 * modal would surface uninstallable cards. See
 * `CATEGORY_TO_DISPUTE_TYPE` in `lib/rules/disputeTypes.ts` for the
 * one canonical vocabulary shared across the UI, the API and the DB.
 */
export const FAMILY_TO_DISPUTE_TYPE: Record<string, string> = {
  fraud: "FRAUDULENT",
  pnr: "PRODUCT_NOT_RECEIVED",
  not_as_described: "PRODUCT_UNACCEPTABLE",
  subscription: "SUBSCRIPTION_CANCELLED",
  refund: "CREDIT_NOT_PROCESSED",
  duplicate: "DUPLICATE",
  general: "GENERAL",
};

/**
 * Shopify dispute-reason code → i18n key under the `reasons.*`
 * namespace.
 */
export const REASON_KEYS: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "productNotReceived",
  PRODUCT_UNACCEPTABLE: "productUnacceptable",
  FRAUDULENT: "fraudulent",
  UNRECOGNIZED: "unrecognized",
  CREDIT_NOT_PROCESSED: "creditNotProcessed",
  SUBSCRIPTION_CANCELLED: "subscriptionCanceled",
  DUPLICATE: "duplicate",
  GENERAL: "general",
};

/**
 * The reasons a merchant can pick when building a custom rule, in display
 * order.
 *
 * ONE list, for both rule builders. The embedded modal and the portal form
 * each used to carry their own copy while importing `REASON_KEYS` for labels
 * only — so the lists could drift from the labels and from each other, and
 * they did: **`UNRECOGNIZED` was missing from both.** A merchant building
 * "auto for fraud" picked `FRAUDULENT` and silently missed every
 * `UNRECOGNIZED` dispute, which fell through to the catch-all. It sits next to
 * `FRAUDULENT` here because `resolveReasonFamily` scores it with the fraud
 * formula (`lib/argument/reasonFamily.ts`).
 *
 * Pinned by `lib/rules/__tests__/ruleReasonOptions.test.ts`.
 */
export const RULE_REASON_CODES: readonly string[] = [
  "FRAUDULENT",
  "UNRECOGNIZED",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELLED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE",
  "GENERAL",
];

/**
 * The same reason, keyed for the embedded surface.
 *
 * The two surfaces store their labels in different namespaces — the portal
 * reads `reasons.<camelCase>`, the embedded modal reads
 * `rules.reason<PascalCase>` — but the two are the same word, derived from the
 * same `REASON_KEYS` entry, so a new reason cannot land in one and not the
 * other.
 */
export function embeddedReasonLabelKey(code: string): string {
  const key = REASON_KEYS[code];
  if (!key) return code.replace(/_/g, " ");
  return `reason${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

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
      // Stored rules written before 2026-07-28 can carry the single-L
      // SUBSCRIPTION_CANCELED spelling — normalise so the label resolves.
      const key = REASON_KEYS[canonicalReasonCode(r) ?? r];
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

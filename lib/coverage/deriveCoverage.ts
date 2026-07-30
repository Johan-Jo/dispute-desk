/**
 * The dispute-family vocabulary shared by the coverage surfaces.
 *
 * This file used to also export `deriveCoverage()`, a flat (non-lifecycle)
 * projection of rules + packs. It had **zero live callers** — every surface
 * moved to `deriveLifecycleCoverage` — while keeping its own copy of
 * `ruleMatchesFamily`, whose "a rule without `match.reason` cannot define a
 * family's mode" predicate is exactly what went stale when the per-family rules
 * collapsed into one store-wide switch. Two copies of one broken predicate is
 * how that drifted, so the dead copy is gone; the family table and the mode
 * type stay, because `deriveLifecycleCoverage` and the packs page import them.
 */

export interface DisputeFamily {
  id: string;
  /** Shopify reason codes that map to this family */
  reasons: string[];
  /** i18n key for the family label (e.g. "coverage.familyFraud") */
  labelKey: string;
}

export const DISPUTE_FAMILIES: DisputeFamily[] = [
  { id: "fraud", reasons: ["FRAUDULENT", "UNRECOGNIZED"], labelKey: "coverage.familyFraud" },
  { id: "pnr", reasons: ["PRODUCT_NOT_RECEIVED"], labelKey: "coverage.familyPnr" },
  { id: "not_as_described", reasons: ["PRODUCT_UNACCEPTABLE", "NOT_AS_DESCRIBED"], labelKey: "coverage.familyNotAsDescribed" },
  { id: "subscription", reasons: ["SUBSCRIPTION_CANCELLED"], labelKey: "coverage.familySubscription" },
  { id: "refund", reasons: ["CREDIT_NOT_PROCESSED"], labelKey: "coverage.familyRefund" },
  { id: "duplicate", reasons: ["DUPLICATE"], labelKey: "coverage.familyDuplicate" },
  { id: "general", reasons: ["GENERAL"], labelKey: "coverage.familyGeneral" },
];

/**
 * `manual` / `notify` are legacy stored values that normalize to review (see
 * lib/rules/normalizeMode.ts). `none` is retained for back-compat with stored
 * shapes; `deriveLifecycleCoverage` no longer emits it, because a family with
 * no rule of its own inherits the store-wide switch rather than having no mode.
 */
export type AutomationMode = "automated" | "review_first" | "manual" | "notify" | "none";

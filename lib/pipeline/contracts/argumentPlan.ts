/**
 * `CaseArgumentPlanSnapshot` — layer 3, and the ONLY owner of issuer-facing
 * claim authority.
 *
 * THE RULE THIS SHAPE EXISTS TO ENFORCE. Nothing downstream of the plan may
 * decide whether a fact belongs in the letter. Package generation, thesis
 * construction, Evidence Basis, Case Details and chronology all become
 * projections of `included`. If a consumer needs a fact that is not in
 * `included`, the answer is to fix the plan, never to add a second predicate.
 *
 * WHY THE EXCLUSION LIST IS PART OF THE CONTRACT. A fact excluded silently is
 * indistinguishable from a fact that was never collected — and the difference
 * matters twice: the merchant is owed the reason, and the rebuild must be able
 * to prove no sentence survived its support. `excluded` carries both.
 *
 * ARGUMENT RELEVANCE IS NOT MERCHANT RELEVANCE. `reasonCodeModule.allowedFact
 * Categories` decides which facts belong in *this* argument; the evidence model
 * decides what is true. Conflating them is what made P4-as-specced unfulfillable
 * (0 of 76 packages identical). The maintainer decided 2026-08-04 that the
 * allow-list stays; this plan consumes it, it does not replace it.
 */

import type { SnapshotFreshness } from "./freshness";

export type ExclusionReason =
  | "review_required"
  | "unverified"
  | "adverse"
  | "merchant_only"
  | "not_argument_relevant";

export interface IncludedFact {
  recordId: string;
  fieldKey: string;
  /** The argument category this fact supports. Drives section composition. */
  factCategory: string;
}

export interface ExcludedFact {
  recordId: string;
  fieldKey: string;
  /**
   * Symmetric with `IncludedFact` (revision 1, Agent B's friction 2). Without
   * it, a reader of a persisted snapshot cannot tell whether the excluded record
   * was in the module's `criticalCategories` — which is exactly what separates
   * `no_primary_argument` from `all_support_excluded`. The derivation knows;
   * the snapshot has to keep it or the verdict cannot be re-audited later.
   */
  factCategory: string;
  reason: ExclusionReason;
  /** I18nToken key. Merchant-facing only — never reaches the issuer. */
  merchantReasonToken: string | null;
}

/**
 * Why no safe argument remains, when that is the outcome.
 *
 * This is a real product state, not an error: it means the honest answer is
 * "we will not file", and the merchant is notified. It is NOT a reason to
 * lower the bar and file something weaker.
 */
export type NoSafeArgumentReason =
  | "no_primary_argument"
  | "no_rebuttal_argument"
  | "all_support_excluded";

export interface CaseArgumentPlanSnapshot {
  caseId: string;
  planVersion: number;
  /** Resolved reason-code module identity. Pins which allow-list applied. */
  reasonModuleId: string;
  included: IncludedFact[];
  excluded: ExcludedFact[];
  /**
   * Null when a safe argument exists. Non-null means nothing may be generated
   * as fileable for this case.
   */
  noSafeArgument: NoSafeArgumentReason | null;
  /**
   * True while any `review_required` item remains excluded.
   *
   * NOT the only source of deadline-only-ness (revision 1, Agent B's friction
   * 6). A package is `deadline_only` when THIS is true **or** the automation
   * decision holds (`hold_for_deadline` / `park_for_review`). The plan owns the
   * evidence-shaped reason; automation owns the policy-shaped one; the selector
   * ORs them. Neither layer may read the other's internals to compute it.
   */
  deadlineOnly: boolean;
  freshness: SnapshotFreshness;
}

/**
 * Deterministic validation, run AFTER composition.
 *
 * "Deterministic" is the point: the same document must produce the same verdict
 * on every run, so a failure is a fact about the document rather than a model
 * mood. A failure makes the package non-fileable — it never downgrades to a
 * warning.
 */
export interface DocumentValidationResult {
  passed: boolean;
  /** Stable machine codes, never prose. Rendered through i18n if surfaced. */
  failureCodes: string[];
}

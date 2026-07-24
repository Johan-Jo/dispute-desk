/**
 * Shared presentation model — canonical types.
 *
 * Four INDEPENDENT dimensions of a dispute's presentation. They are
 * resolved separately and must never overwrite one another:
 *
 *   1. Operational lifecycle — what DisputeDesk is doing (current state).
 *      Derived from objective operational facts ONLY.
 *   2. Merchant attention — whether the merchant must act.
 *      Never modifies lifecycle.
 *   3. Evidence strength — rules-engine grade, passed through verbatim.
 *   4. External lifecycle — confirmed transmission + outcome milestones.
 *
 * Spec: docs/plans/design-alignment-shared-presentation-model.plan.md
 * (§0 model, §3 resolvers, §12V verified data semantics).
 *
 * "Sent to card network" is a MILESTONE, not a current lifecycle state:
 * once transmission is confirmed the current state is `under_review`
 * (no backend field distinguishes "just sent" from "under review").
 */

/** Dimension 1 — operational lifecycle (current state). */
export type OperationalLifecycle =
  | "building_evidence"
  | "monitoring"
  | "pack_prepared"
  | "saved_to_shopify"
  | "under_review"
  | "won"
  | "lost"
  | "closed";

/** Dimension 2 — merchant attention.
 *
 * Deterministic ladder (plan §3.1): a state that is `blocking` is never
 * also `requested`; an explicit ask (`requested`) is never also
 * `recommended`; a recommended concrete item is never mere
 * `opportunity`. Deadline risk is a separate fact that amplifies
 * emphasis — it is NOT an attention value.
 */
export type MerchantAttention =
  | "none"
  | "opportunity"
  | "recommended"
  | "requested"
  | "blocking"
  | "technical_error";

/** Attention values that constitute a genuine merchant task — the ONLY
 *  values that enter "Action required" / `merchantActionCount`.
 *  `opportunity` and `recommended` are deliberately excluded. */
export const ACTION_REQUIRED_ATTENTION: ReadonlySet<MerchantAttention> =
  new Set(["blocking", "requested", "technical_error"]);

/** Dimension 3 — evidence strength (rules engine only).
 *  `not_assessed` maps from `caseStrength.overall === "insufficient"`
 *  (the engine's true pre-assessment value — lib/argument/types.ts:13,
 *  caseStrength.ts:360-364). Never re-derived in the UI. */
export type EvidenceStrength = "strong" | "moderate" | "weak" | "not_assessed";

/** Dashboard operational buckets — mutually exclusive, precedence
 *  Closed → Under review → Action required → Building & monitoring
 *  (plan §4). */
export type DashboardBucket =
  | "closed"
  | "under_review"
  | "action_required"
  | "building_monitoring";

/** Terminal outcome for display. `closed` = reliably terminal without a
 *  supported won/lost outcome (neutral label, plan §3.1 rung 1). */
export type OutcomeKind = "pending" | "won" | "lost" | "closed";

/** The composed result — one interpretation shared by dashboard, list,
 *  and detail. */
export interface DisputePresentation {
  lifecycle: OperationalLifecycle;
  attention: MerchantAttention;
  strength: EvidenceStrength;
  /** Reliable external transmission confirmed (Shopify `evidenceSentOn`
   *  → `submission_state='submitted_confirmed'`, or Shopify status
   *  `under_review` → `normalized_status='submitted_to_bank'`). */
  transmissionConfirmed: boolean;
  /** The response can still change (pre-transmission, pre-terminal). */
  editable: boolean;
  /** Reliably terminal (won/lost/closed). */
  terminal: boolean;
  outcome: OutcomeKind;
  /** An internal (non-merchant-resolvable) technical issue exists.
   *  Surfaces transparency copy only — never Action required
   *  (§12V decision 4). */
  internalIssue: boolean;
  /** The specific cause when attention === "blocking" (approval_gate /
   *  missing_required_evidence / billing reasons / auto_build_off) —
   *  surfaces label the block truthfully instead of a generic pill. */
  blockingReason: string | null;
  /** True when this dispute counts as a genuine merchant task
   *  (attention ∈ ACTION_REQUIRED_ATTENTION). */
  needsMerchantAction: boolean;
  /** Active inventory membership (unresolved pre-outcome; §5). */
  isActive: boolean;
}

/**
 * Evidence item model v2.
 *
 * Replaces the flat required/present/collectable model with a richer
 * status + priority + blocking system that separates "completeness"
 * (how much evidence you have) from "readiness" (whether you can submit).
 *
 * Key principle: DisputeDesk should guide, not falsely prevent.
 * "Critical" does NOT mean "hard-block". Only platform-mandated
 * blockers (blocking: true) prevent submission.
 */

/* ── Item states ── */

/** Collection status. */
export type EvidenceItemStatus =
  | "available" // present in the pack
  | "missing" // not present, could be added
  | "unavailable" // cannot be collected (context-dependent)
  | "waived"; // merchant dismissed it

/** Win-rate impact priority. */
export type EvidenceItemPriority =
  | "critical" // strongly impacts win rate
  | "recommended" // helps but not essential
  | "optional"; // nice to have

/** How the evidence was or would be sourced. */
export type EvidenceItemSource =
  | "auto_shopify" // collected from Shopify order/fulfillment/payment
  | "manual_upload" // merchant uploaded a file
  | "manual_note" // merchant typed a note
  | "auto_policy" // pulled from policy_snapshots
  | "unavailable_from_source"; // source exists but data is not available

/* ── Checklist item ── */

/** A single checklist item in the v2 model. */
export interface ChecklistItemV2 {
  field: string;
  label: string;
  status: EvidenceItemStatus;
  priority: EvidenceItemPriority;
  /** True only when submission literally cannot proceed without this. */
  blocking: boolean;
  source: EvidenceItemSource;
  /** Why the item is unavailable (only set when status = "unavailable"). */
  unavailableReason?: string;
  /** Waive metadata (only set when status = "waived"). */
  waiveReason?: WaiveReason;
  waiveNote?: string;
  waivedAt?: string;
  waivedBy?: string;
}

/* ── Submission readiness ── */

/** Orthogonal to completeness score. */
export type SubmissionReadiness =
  | "ready" // all critical items present or waived
  | "ready_with_warnings" // critical non-blocking items missing
  | "blocked" // blocking items missing
  | "submitted"; // already sent to Shopify

export const SUBMISSION_READINESS_VALUES = [
  "ready",
  "ready_with_warnings",
  "blocked",
  "submitted",
] as const;

/* ── Waive flow ── */

/** Controlled vocabulary for waive reasons. */
export type WaiveReason =
  | "not_applicable" // "Not applicable to this dispute"
  | "evidence_unavailable" // "I can't get this evidence"
  | "already_in_shopify" // "Already submitted separately"
  | "merchant_accepts_risk" // "I understand the risk"
  | "other"; // free text (requires waiveNote)

export const WAIVE_REASONS: WaiveReason[] = [
  "not_applicable",
  "evidence_unavailable",
  "already_in_shopify",
  "merchant_accepts_risk",
  "other",
];

/** Stored waived item record (persisted in evidence_packs.waived_items). */
export interface WaivedItemRecord {
  field: string;
  label: string;
  reason: WaiveReason;
  note?: string;
  waivedAt: string;
  waivedBy: "merchant" | "system";
}

/* ── Completeness result v2 ── */

/** Full completeness + readiness result from the v2 engine. */
export interface CompletenessResultV2 {
  /** Percentage of evidence weight collected (0-100). */
  completenessScore: number;
  /** Simple present/total ratio (0-100). */
  evidenceStrengthScore: number;
  /** New v2 checklist with priority, blocking, status. */
  checklist: ChecklistItemV2[];
  /** Derived from checklist: can the merchant submit? */
  submissionReadiness: SubmissionReadiness;
  /** Labels of items that are blocking: true + status: missing. */
  blockers: string[];
  /** Labels of critical non-blocking missing items. */
  warnings: string[];
  /** Suggested actions for recommended items. */
  recommendedActions: string[];

  /** Legacy compat: v1 checklist format (written to `checklist` column). */
  legacyChecklist: Array<{
    field: string;
    label: string;
    required: boolean;
    present: boolean;
  }>;
  /** Legacy compat: v1 blockers (required + missing + collectable labels). */
  legacyBlockers: string[];
  /** Legacy compat: v1 recommended actions. */
  legacyRecommendedActions: string[];
}

/* ── Reason template v2 ── */

/** Per-field config in a reason template. */
export interface TemplateFieldV2 {
  field: string;
  label: string;
  /** Conditional requirement mode (same as v1, used to resolve collectable). */
  requirementMode:
    | "required_always"
    | "required_if_fulfilled"
    | "required_if_card_payment"
    | "recommended"
    | "optional";
  priority: EvidenceItemPriority;
  /** True only for platform-mandated blockers. Almost always false. */
  blocking: boolean;
  expectedSource: EvidenceItemSource;
}

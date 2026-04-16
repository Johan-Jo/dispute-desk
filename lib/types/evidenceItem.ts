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
  /** How this evidence is obtained. */
  collectionType?: EvidenceCollectionType;
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

/* ── Evidence Collection Type ── */

/** How evidence is obtained. More precise than source alone. */
export type EvidenceCollectionType =
  | "auto"                // Always auto-collected from Shopify
  | "conditional_auto"    // Auto-collected when conditions are met (e.g., card payment for AVS)
  | "manual"              // Merchant must upload or provide
  | "unavailable";        // Cannot be auto-collected from current integrations

/* ── Structured Rebuttal Reason ── */

/** Primary reason why the dispute is invalid. */
export type RebuttalReasonKey =
  | "CUSTOMER_AUTHORIZED_TRANSACTION"
  | "ORDER_WAS_FULFILLED_AND_DELIVERED"
  | "ITEM_MATCHED_DESCRIPTION"
  | "REFUND_ALREADY_ISSUED_OR_NOT_REQUIRED"
  | "SUBSCRIPTION_OR_TERMS_WERE_ACCEPTED"
  | "DIGITAL_GOODS_OR_SERVICE_WAS_DELIVERED"
  | "DISPUTE_REFERENCES_WRONG_TRANSACTION"
  | "CUSTOMER_USED_PRODUCT_OR_SERVICE"
  | "CUSTOMER_DID_NOT_ATTEMPT_RESOLUTION"
  | "OTHER_SUPPORTING_CONTEXT";

export const REBUTTAL_REASONS: Record<RebuttalReasonKey, string> = {
  CUSTOMER_AUTHORIZED_TRANSACTION: "Customer authorized the transaction",
  ORDER_WAS_FULFILLED_AND_DELIVERED: "Order was fulfilled and delivered",
  ITEM_MATCHED_DESCRIPTION: "Item matched its description",
  REFUND_ALREADY_ISSUED_OR_NOT_REQUIRED: "Refund already issued or not required",
  SUBSCRIPTION_OR_TERMS_WERE_ACCEPTED: "Subscription or terms were accepted",
  DIGITAL_GOODS_OR_SERVICE_WAS_DELIVERED: "Digital goods or service was delivered",
  DISPUTE_REFERENCES_WRONG_TRANSACTION: "Dispute references the wrong transaction",
  CUSTOMER_USED_PRODUCT_OR_SERVICE: "Customer used the product or service",
  CUSTOMER_DID_NOT_ATTEMPT_RESOLUTION: "Customer did not attempt resolution",
  OTHER_SUPPORTING_CONTEXT: "Other supporting context",
};

export interface RebuttalReasonSelection {
  key: RebuttalReasonKey;
  label: string;
  source: "auto" | "manual";
  confidence: "high" | "medium" | "low";
  why: string;
}

/* ── 3D Secure Evidence Model ── */

/**
 * 3D Secure authentication evidence.
 *
 * CRITICAL: Shopify does NOT provide a stable typed field for 3DS
 * authentication results. We MUST NOT:
 * - Infer 3DS from AVS/CVV codes
 * - Parse receiptJson (gateway-defined, unstable)
 * - Generate text claiming 3DS unless confirmed from a trusted source
 */
export interface ThreeDSecureEvidence {
  /** Whether we have confirmed 3DS authentication data. */
  availability: "confirmed" | "unknown" | "not_available_automatically";
  /** Where the 3DS data came from. */
  source: "shopify_typed" | "provider_specific" | "manual_upload" | "none";
  /** Whether the system can auto-generate a 3DS claim. */
  canAutoClaim: boolean;
  /** How important this evidence is for the current dispute. */
  strength: "critical" | "strong" | "supporting" | "none";
}

/**
 * Default 3DS state. Conservative: unknown availability, no auto-claim.
 * Only upgraded when a trusted source confirms authentication.
 */
export const DEFAULT_THREEDS: ThreeDSecureEvidence = {
  availability: "not_available_automatically",
  source: "none",
  canAutoClaim: false,
  strength: "none",
};

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
  /** How this evidence is obtained. */
  collectionType: EvidenceCollectionType;
}

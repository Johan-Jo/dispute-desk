/**
 * Rebuttal reason auto-selection engine.
 *
 * Maps dispute reason → default rebuttal reason key.
 * Adjusts confidence based on available evidence.
 * Never selects a reason that cannot be supported.
 */

import type {
  RebuttalReasonKey,
  RebuttalReasonSelection,
  ChecklistItemV2,
} from "@/lib/types/evidenceItem";
import { REBUTTAL_REASONS } from "@/lib/types/evidenceItem";

/* ── Reason → Default Rebuttal Mapping ── */

interface ReasonMapping {
  defaultKey: RebuttalReasonKey;
  why: string;
  /** Evidence fields that must be available for high confidence. */
  requiredForHigh: string[];
  /** Evidence fields that contribute to confidence. */
  supporting: string[];
}

const REASON_MAP: Record<string, ReasonMapping> = {
  FRAUDULENT: {
    defaultKey: "CUSTOMER_AUTHORIZED_TRANSACTION",
    why: "Fraud disputes center on transaction authorization",
    requiredForHigh: ["avs_cvv_match", "billing_address_match"],
    supporting: ["shipping_tracking", "delivery_proof", "activity_log"],
  },
  PRODUCT_NOT_RECEIVED: {
    defaultKey: "ORDER_WAS_FULFILLED_AND_DELIVERED",
    why: "Not-received disputes require proof of delivery",
    requiredForHigh: ["shipping_tracking", "delivery_proof"],
    supporting: ["customer_communication", "shipping_policy"],
  },
  PRODUCT_UNACCEPTABLE: {
    defaultKey: "ITEM_MATCHED_DESCRIPTION",
    why: "Not-as-described disputes require proof the item matched its listing",
    requiredForHigh: ["product_description", "refund_policy"],
    supporting: ["customer_communication", "supporting_documents"],
  },
  SUBSCRIPTION_CANCELED: {
    defaultKey: "SUBSCRIPTION_OR_TERMS_WERE_ACCEPTED",
    why: "Subscription disputes require proof of disclosed terms",
    requiredForHigh: ["cancellation_policy"],
    supporting: ["customer_communication", "activity_log"],
  },
  DUPLICATE: {
    defaultKey: "DISPUTE_REFERENCES_WRONG_TRANSACTION",
    why: "Duplicate disputes require proof of distinct transactions",
    requiredForHigh: ["order_confirmation", "duplicate_explanation"],
    supporting: ["supporting_documents"],
  },
  CREDIT_NOT_PROCESSED: {
    defaultKey: "REFUND_ALREADY_ISSUED_OR_NOT_REQUIRED",
    why: "Credit disputes require proof of refund or justification",
    requiredForHigh: ["order_confirmation"],
    supporting: ["refund_policy", "customer_communication"],
  },
  GENERAL: {
    defaultKey: "OTHER_SUPPORTING_CONTEXT",
    why: "General disputes require contextual evidence",
    requiredForHigh: ["order_confirmation"],
    supporting: ["shipping_tracking", "customer_communication"],
  },
};

/**
 * Auto-select the best rebuttal reason for a dispute.
 *
 * Rules:
 * - Start with the default for the dispute reason
 * - Calculate confidence from available evidence
 * - Never select a reason that cannot be supported
 * - If weak evidence → keep default but confidence = low
 */
export function selectRebuttalReason(
  disputeReason: string | null | undefined,
  checklist: ChecklistItemV2[],
): RebuttalReasonSelection {
  const reasonKey = disputeReason?.toUpperCase().replace(/\s+/g, "_") ?? "GENERAL";
  const mapping = REASON_MAP[reasonKey] ?? REASON_MAP.GENERAL;

  const fieldStatus = new Map<string, string>();
  for (const item of checklist) {
    fieldStatus.set(item.field, item.status);
  }

  // Count how many required-for-high fields are available
  const requiredAvailable = mapping.requiredForHigh.filter((f) => {
    const s = fieldStatus.get(f);
    return s === "available" || s === "waived";
  }).length;

  const supportingAvailable = mapping.supporting.filter((f) => {
    const s = fieldStatus.get(f);
    return s === "available" || s === "waived";
  }).length;

  // Determine confidence
  let confidence: "high" | "medium" | "low";
  if (
    mapping.requiredForHigh.length > 0 &&
    requiredAvailable === mapping.requiredForHigh.length
  ) {
    confidence = "high";
  } else if (requiredAvailable > 0 || supportingAvailable > 0) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    key: mapping.defaultKey,
    label: REBUTTAL_REASONS[mapping.defaultKey],
    source: "auto",
    confidence,
    why: mapping.why,
  };
}

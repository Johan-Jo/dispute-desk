/**
 * Static per-field strength label used by the merchant-facing evidence list.
 *
 * Independent from `caseStrength.ts` tiers, which determine the OVERALL
 * case verdict (strong / moderate / weak / insufficient). This map drives
 * the per-row badge only — a fixed classification of the evidence type's
 * power rather than a dynamic readout of how strong the case currently is.
 *
 * Two values, intentionally:
 *   - "Strong evidence"     — direct fulfillment proofs the bank weighs heaviest
 *   - "Supporting evidence" — corroborating signals (verification, history, IP, …)
 */

export type EvidenceStrengthLabel = "Strong evidence" | "Supporting evidence";

export const EVIDENCE_STRENGTH_LABEL: Record<string, EvidenceStrengthLabel> = {
  // Supporting evidence — corroborating signals that strengthen the case
  // without being direct proof of fulfillment.
  order_confirmation: "Supporting evidence",
  avs_cvv_match: "Supporting evidence",
  activity_log: "Supporting evidence",
  customer_communication: "Supporting evidence",
  customer_account_info: "Supporting evidence",
  device_session_consistency: "Supporting evidence",
  ip_location_check: "Supporting evidence",

  // Strong evidence — direct fulfillment / delivery proofs.
  shipping_tracking: "Strong evidence",
  delivery_proof: "Strong evidence",
};

/**
 * Lookup with a safe default. Unknown fields fall back to "Supporting evidence"
 * so a new field added without touching this file still renders something
 * coherent (rather than a missing badge).
 */
export function evidenceStrengthLabel(field: string): EvidenceStrengthLabel {
  return EVIDENCE_STRENGTH_LABEL[field] ?? "Supporting evidence";
}

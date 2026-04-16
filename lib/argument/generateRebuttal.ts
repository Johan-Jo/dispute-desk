/**
 * Generate a bank-facing dispute response from an ArgumentMap.
 *
 * Delegates to the Response Engine which enforces:
 * - Every statement backed by evidence
 * - Missing evidence sections completely omitted
 * - Response shaped to dispute reason family
 * - Zero generic filler or unsupported claims
 * - Defense position classified from evidence hierarchy
 *
 * See lib/argument/responseEngine.ts for the full rule set.
 */

import type { ArgumentMap, RebuttalDraft } from "./types";
import type { RebuttalReasonSelection } from "@/lib/types/evidenceItem";
import {
  generateDisputeResponse,
  resolveReasonFamily,
  type EvidenceFlags,
  type EvidenceData,
  type DefenseClassification,
} from "./responseEngine";

export interface RebuttalDraftWithClassification extends RebuttalDraft {
  defensePosition: DefenseClassification;
}

/**
 * Build EvidenceFlags from the ArgumentMap's supporting evidence.
 * A flag is true ONLY when the corresponding evidence is present
 * in at least one claim's supporting list.
 */
function buildFlags(argumentMap: ArgumentMap): EvidenceFlags {
  const allSupporting = new Set<string>();
  for (const claim of argumentMap.counterclaims) {
    for (const s of claim.supporting) allSupporting.add(s.field);
  }

  return {
    avs: allSupporting.has("avs_cvv_match"),
    cvv: allSupporting.has("avs_cvv_match"),
    tracking: allSupporting.has("shipping_tracking"),
    deliveryConfirmed: allSupporting.has("delivery_proof"),
    customerContact: allSupporting.has("customer_communication"),
    billingShippingMatch: allSupporting.has("billing_address_match"),
    orderConfirmation: allSupporting.has("order_confirmation"),
    customerHistory: allSupporting.has("activity_log"),
    policyAttached:
      allSupporting.has("refund_policy") ||
      allSupporting.has("shipping_policy") ||
      allSupporting.has("cancellation_policy"),
    refundIssued: false,
    refundAmountMatches: false,
    cancellationRequest: false,
    cancellationConfirmed: false,
    disputeWithdrawalEvidence: false,
    productDescription: allSupporting.has("product_description"),
    digitalAccessLogs: false,
    duplicateChargeEvidence: allSupporting.has("duplicate_explanation"),
    amountCorrectEvidence: false,
  };
}

export function generateRebuttalDraft(
  argumentMap: ArgumentMap,
  _rebuttalReason?: RebuttalReasonSelection,
  evidenceData?: EvidenceData,
): RebuttalDraftWithClassification {
  const family = resolveReasonFamily(argumentMap.issuerClaim.reasonCode);
  const flags = buildFlags(argumentMap);

  const result = generateDisputeResponse(family, flags, evidenceData ?? {});

  return {
    sections: result.sections,
    source: "generated",
    defensePosition: result.defensePosition,
  };
}

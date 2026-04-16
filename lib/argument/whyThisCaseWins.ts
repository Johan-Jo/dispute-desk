/**
 * Generate "Why This Case Should Win" — strengths and weaknesses.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ArgumentMap, WhyWinsResult, CaseStrengthLevel } from "./types";

/** Human-readable strength descriptions per evidence field. */
const STRENGTH_DESCRIPTIONS: Record<string, string> = {
  avs_cvv_match: "AVS and CVV passed",
  billing_address_match: "Billing address matches order",
  shipping_tracking: "Shipment confirmed with tracking",
  delivery_proof: "Delivery confirmed by carrier",
  customer_communication: "Customer communication documented",
  order_confirmation: "Order details verified",
  refund_policy: "Refund policy was disclosed",
  shipping_policy: "Shipping policy was disclosed",
  cancellation_policy: "Cancellation policy was disclosed",
  product_description: "Product description matches listing",
  activity_log: "Customer account activity verified",
  duplicate_explanation: "Separate transactions documented",
  customer_ip: "IP address matches billing region",
  risk_analysis: "Fraud risk assessment favorable",
};

const WEAKNESS_DESCRIPTIONS: Record<string, string> = {
  avs_cvv_match: "No AVS/CVV verification available",
  billing_address_match: "Billing address could not be verified",
  shipping_tracking: "No shipping tracking available",
  delivery_proof: "No delivery confirmation on file",
  customer_communication: "No customer communication recorded",
  activity_log: "No prior purchase history on file",
  product_description: "Product description not documented",
  refund_policy: "Refund policy not captured",
  shipping_policy: "Shipping policy not captured",
  cancellation_policy: "Cancellation policy not captured",
  customer_ip: "Customer IP address not available",
  risk_analysis: "No fraud risk assessment available",
};

export function generateWhyWins(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
): WhyWinsResult {
  if (!argumentMap) {
    return { strengths: [], weaknesses: [], overall: "insufficient" };
  }

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  // Collect all evidence fields across all claims
  for (const claim of argumentMap.counterclaims) {
    for (const s of claim.supporting) {
      const desc = STRENGTH_DESCRIPTIONS[s.field];
      if (desc && !strengths.includes(desc)) {
        strengths.push(desc);
      }
    }
    for (const m of claim.missing) {
      if (m.impact === "high" || m.impact === "medium") {
        const desc = WEAKNESS_DESCRIPTIONS[m.field];
        if (desc && !weaknesses.includes(desc)) {
          weaknesses.push(desc);
        }
      }
    }
  }

  return {
    strengths,
    weaknesses,
    overall: argumentMap.overallStrength,
  };
}

/**
 * Risk explanation for the Review & Submit tab.
 *
 * Answers: "What happens if you submit now?"
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ArgumentMap, RiskResult, CaseStrengthLevel } from "./types";

const RISK_DESCRIPTIONS: Record<string, string> = {
  // System-derived: descriptive, not action-oriented
  avs_cvv_match: "AVS/CVV data is not available for this transaction",
  billing_address_match: "Billing/shipping consistency could not be determined",
  // Merchant-actionable: these are real gaps the merchant can address
  shipping_tracking: "No tracking data weakens delivery proof",
  delivery_proof: "No delivery confirmation is a significant gap",
  customer_communication: "No customer communication reduces merchant credibility",
  refund_policy: "Refund policy not captured",
  shipping_policy: "Shipping policy not captured",
  cancellation_policy: "Cancellation policy not captured",
  product_description: "No product description weakens case",
  activity_log: "No customer purchase history available",
};

export function generateRiskExplanation(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
): RiskResult {
  if (!argumentMap) {
    return {
      expectedOutcome: "insufficient",
      risks: ["No argument has been generated yet"],
    };
  }

  const risks: string[] = [];

  for (const claim of argumentMap.counterclaims) {
    for (const m of claim.missing) {
      const desc = RISK_DESCRIPTIONS[m.field];
      if (desc && !risks.includes(desc)) {
        risks.push(desc);
      }
    }
  }

  return {
    expectedOutcome: argumentMap.overallStrength,
    risks,
  };
}

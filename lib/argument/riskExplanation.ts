/**
 * Risk explanation for the Review & Submit tab.
 *
 * Answers: "What happens if you submit now?"
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ArgumentMap, RiskResult, CaseStrengthLevel } from "./types";

const RISK_DESCRIPTIONS: Record<string, string> = {
  avs_cvv_match: "Missing AVS/CVV verification weakens fraud defense",
  billing_address_match: "Unverified billing address reduces credibility",
  shipping_tracking: "No tracking data weakens delivery proof",
  delivery_proof: "Missing delivery confirmation is a significant gap",
  customer_communication: "No customer communication reduces merchant credibility",
  refund_policy: "Missing refund policy weakens policy defense",
  shipping_policy: "Missing shipping policy weakens shipping claims",
  cancellation_policy: "Missing cancellation policy weakens subscription defense",
  product_description: "No product description weakens 'as described' defense",
  activity_log: "No customer history reduces fraud defense",
  customer_ip: "Missing IP data reduces identity verification",
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

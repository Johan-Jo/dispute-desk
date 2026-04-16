/**
 * Case strength calculation.
 *
 * Derives overall strength from argument map claims + evidence state.
 * Also computes the single best improvement action.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type {
  ArgumentMap,
  CaseStrengthResult,
  CaseStrengthLevel,
  ImprovementSignal,
} from "./types";
import { getArgumentTemplate } from "./templates";

const FIELD_LABELS: Record<string, string> = {
  order_confirmation: "Order Confirmation",
  billing_address_match: "Billing Address Match",
  avs_cvv_match: "AVS / CVV Result",
  shipping_tracking: "Shipping Tracking",
  delivery_proof: "Delivery Proof",
  customer_communication: "Customer Communication",
  activity_log: "Activity Log",
  refund_policy: "Refund Policy",
  shipping_policy: "Shipping Policy",
  cancellation_policy: "Cancellation Policy",
  product_description: "Product Description",
  duplicate_explanation: "Duplicate Explanation",
  supporting_documents: "Supporting Documents",
};

export function calculateCaseStrength(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
): CaseStrengthResult {
  if (!argumentMap || argumentMap.counterclaims.length === 0) {
    return {
      overall: "insufficient",
      score: 0,
      supportedClaims: 0,
      totalClaims: 0,
      improvementHint: null,
    };
  }

  const totalClaims = argumentMap.counterclaims.length;
  const supportedClaims = argumentMap.counterclaims.filter(
    (c) => c.strength === "strong" || c.strength === "moderate",
  ).length;

  const score = Math.round((supportedClaims / totalClaims) * 100);

  // Find the weakest claim that could be improved
  let improvementHint: string | null = null;
  for (const claim of argumentMap.counterclaims) {
    if (claim.strength !== "strong" && claim.missing.length > 0) {
      const topMissing = claim.missing[0];
      const label = FIELD_LABELS[topMissing.field] ?? topMissing.label;
      improvementHint = `Add ${label} to strengthen "${claim.title}"`;
      break;
    }
  }

  return {
    overall: argumentMap.overallStrength,
    score,
    supportedClaims,
    totalClaims,
    improvementHint,
  };
}

/**
 * Calculate the improvement signal: what happens if the merchant
 * adds the single highest-impact missing item.
 */
export function calculateImprovement(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
  reason: string | null | undefined,
): ImprovementSignal | null {
  if (!argumentMap) return null;
  if (argumentMap.overallStrength === "strong") return null;

  // Find the claim with the most impact gap
  for (const claim of argumentMap.counterclaims) {
    if (claim.strength === "strong") continue;
    const highImpactMissing = claim.missing.filter(
      (m) => m.impact === "high",
    );
    if (highImpactMissing.length === 0) continue;

    const field = highImpactMissing[0].field;
    const label = FIELD_LABELS[field] ?? highImpactMissing[0].label;

    // Simulate: what would strength be if this item were present?
    const wouldBeStrong =
      claim.supporting.length + 1 >=
      (getArgumentTemplate(reason).counterclaims.find(
        (c) => c.id === claim.id,
      )?.requiredEvidence.length ?? 1);

    if (!wouldBeStrong) continue;

    // Would overall improve?
    const currentStrength = argumentMap.overallStrength;
    // If fixing the weakest claim would make it strong, and all others
    // are already strong, overall would improve
    const otherClaimsStrong = argumentMap.counterclaims
      .filter((c) => c.id !== claim.id)
      .every((c) => c.strength === "strong" || c.strength === "moderate");

    if (otherClaimsStrong) {
      return {
        currentStrength,
        potentialStrength: "strong",
        action: `Add ${label}`,
        field,
      };
    }

    return {
      currentStrength,
      potentialStrength: "moderate",
      action: `Add ${label}`,
      field,
    };
  }

  return null;
}

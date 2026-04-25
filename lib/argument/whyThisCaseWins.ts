/**
 * Generate "Why This Case Should Win" — strengths and weaknesses.
 *
 * Each returned item carries the originating `counterclaimId` so the UI
 * can resolve back to `argumentMap.counterclaimsById[id]` for strength
 * pill and supporting/missing field lists — without text-matching, per
 * the NO IMPLICIT UI MAPPING rule (plan v3 §0).
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type {
  ArgumentMap,
  WhyWinsResult,
  WhyWinsItem,
  CaseStrengthLevel,
} from "./types";

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
};

export function generateWhyWins(
  argumentMap: ArgumentMap | null,
  checklist: ChecklistItemV2[],
  weightedStrength?: CaseStrengthLevel,
): WhyWinsResult {
  if (!argumentMap) {
    return { strengths: [], weaknesses: [], overall: "insufficient" };
  }

  const strengths: WhyWinsItem[] = [];
  const weaknesses: WhyWinsItem[] = [];
  // Dedupe by description text — first counterclaim that surfaces a given
  // description claims it. Subsequent counterclaims do not produce a
  // duplicate row but still have their own provenance via `counterclaim.supporting[]`
  // when the UI iterates the counterclaim directly.
  const seenStrengths = new Set<string>();
  const seenWeaknesses = new Set<string>();

  for (const claim of argumentMap.counterclaims) {
    for (const s of claim.supporting) {
      const desc = STRENGTH_DESCRIPTIONS[s.field];
      if (desc && !seenStrengths.has(desc)) {
        seenStrengths.add(desc);
        strengths.push({ text: desc, counterclaimId: claim.id });
      }
    }
    // Only include weaknesses from merchant-actionable missing items.
    for (const m of claim.missing) {
      if (m.impact === "high" || m.impact === "medium") {
        const desc = WEAKNESS_DESCRIPTIONS[m.field];
        if (desc && !seenWeaknesses.has(desc)) {
          seenWeaknesses.add(desc);
          weaknesses.push({ text: desc, counterclaimId: claim.id });
        }
      }
    }
  }

  // Use weighted strength (from caseStrength engine) when provided,
  // NOT the argument map's raw claim-based strength which causes
  // contradictions (e.g., "insufficient" when AVS/CVV is strong).
  const overall = weightedStrength ?? argumentMap.overallStrength;

  return { strengths, weaknesses, overall };
}

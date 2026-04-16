/**
 * Generate an ArgumentMap from dispute reason + evidence state.
 *
 * Evaluates each counterclaim template against the present/waived
 * evidence fields. Per-claim strength is derived from the ratio
 * of available required evidence.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type {
  ArgumentMap,
  CounterclaimNode,
  CaseStrengthLevel,
} from "./types";
import { getArgumentTemplate, getIssuerClaimText } from "./templates";

/** Evidence field labels (fallback when not in checklist). */
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
  customer_ip: "Customer Purchase IP",
  risk_analysis: "Fraud Risk Assessment",
};

function getFieldLabel(field: string, checklist: ChecklistItemV2[]): string {
  const item = checklist.find((c) => c.field === field);
  return item?.label ?? FIELD_LABELS[field] ?? field;
}

function claimStrength(
  requiredCount: number,
  presentCount: number,
): CaseStrengthLevel {
  if (requiredCount === 0) return "insufficient";
  const ratio = presentCount / requiredCount;
  if (ratio >= 1) return "strong";
  if (ratio >= 0.5) return "moderate";
  if (ratio > 0) return "weak";
  return "insufficient";
}

/**
 * Generate an argument map from dispute reason and evidence state.
 */
export function generateArgumentMap(
  reason: string | null | undefined,
  checklist: ChecklistItemV2[],
): ArgumentMap {
  const template = getArgumentTemplate(reason);
  const reasonKey = reason?.toUpperCase().replace(/\s+/g, "_") ?? "GENERAL";

  // Build a lookup: field → status
  const fieldStatus = new Map<string, "available" | "missing" | "unavailable" | "waived">();
  for (const item of checklist) {
    fieldStatus.set(item.field, item.status);
  }

  const counterclaims: CounterclaimNode[] = template.counterclaims.map(
    (ct) => {
      const allEvidence = [...ct.requiredEvidence, ...ct.supportingEvidence];
      const supporting: CounterclaimNode["supporting"] = [];
      const missing: CounterclaimNode["missing"] = [];

      for (const field of allEvidence) {
        const status = fieldStatus.get(field) ?? "missing";
        const label = getFieldLabel(field, checklist);
        const isRequired = ct.requiredEvidence.includes(field);

        if (status === "available" || status === "waived") {
          supporting.push({ field, label, status });
        } else if (status === "missing") {
          missing.push({
            field,
            label,
            impact: isRequired ? "high" : "medium",
          });
        }
        // "unavailable" items are omitted — can't be collected
      }

      const requiredPresent = ct.requiredEvidence.filter((f) => {
        const s = fieldStatus.get(f);
        return s === "available" || s === "waived";
      }).length;

      return {
        id: ct.id,
        title: ct.title,
        strength: claimStrength(ct.requiredEvidence.length, requiredPresent),
        supporting,
        missing,
      };
    },
  );

  // Overall strength: weakest claim determines ceiling
  let overallStrength: CaseStrengthLevel = "strong";
  for (const claim of counterclaims) {
    if (
      claim.strength === "insufficient" ||
      (claim.strength === "weak" && overallStrength !== "insufficient")
    ) {
      overallStrength = claim.strength;
    } else if (
      claim.strength === "moderate" &&
      overallStrength === "strong"
    ) {
      overallStrength = "moderate";
    }
  }
  if (counterclaims.length === 0) overallStrength = "insufficient";

  return {
    issuerClaim: {
      text: getIssuerClaimText(reason),
      reasonCode: reasonKey,
    },
    counterclaims,
    overallStrength,
  };
}

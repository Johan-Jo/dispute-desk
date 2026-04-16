/**
 * Generate a structured rebuttal draft from an ArgumentMap.
 *
 * Produces a summary, one section per counterclaim, and a conclusion.
 * Each section references the evidence fields it relies on.
 */

import type { ArgumentMap, RebuttalDraft, RebuttalSection } from "./types";
import type { RebuttalReasonSelection } from "@/lib/types/evidenceItem";

/** Human-readable evidence labels for rebuttal text. */
const EVIDENCE_PHRASES: Record<string, string> = {
  avs_cvv_match: "AVS and CVV verification results",
  billing_address_match: "billing address match confirmation",
  shipping_tracking: "shipping tracking confirmation",
  delivery_proof: "carrier delivery confirmation",
  customer_communication: "customer communication records",
  order_confirmation: "order confirmation details",
  refund_policy: "the store refund policy disclosed at checkout",
  shipping_policy: "the store shipping policy disclosed at checkout",
  cancellation_policy: "the cancellation policy disclosed at checkout",
  product_description: "the product description as advertised",
  activity_log: "customer account activity records",
  duplicate_explanation: "transaction records showing distinct orders",
  supporting_documents: "additional supporting documentation",
};

function evidencePhrase(field: string): string {
  return EVIDENCE_PHRASES[field] ?? field.replace(/_/g, " ");
}

export function generateRebuttalDraft(
  argumentMap: ArgumentMap,
  rebuttalReason?: RebuttalReasonSelection,
): RebuttalDraft {
  const sections: RebuttalSection[] = [];

  // Summary section
  const claimCount = argumentMap.counterclaims.length;
  const strongClaims = argumentMap.counterclaims.filter(
    (c) => c.strength === "strong",
  ).length;

  let summaryText: string;
  if (argumentMap.overallStrength === "strong") {
    summaryText = `We respectfully dispute this claim. Our evidence strongly supports that the transaction was legitimate and the order was properly fulfilled. We present ${claimCount} key arguments below, each supported by verifiable evidence.`;
  } else if (argumentMap.overallStrength === "moderate") {
    summaryText = `We respectfully dispute this claim. We have gathered evidence supporting our position across ${claimCount} key arguments. ${strongClaims > 0 ? `${strongClaims} of these arguments are strongly supported.` : "While some evidence gaps remain, the available evidence supports our position."}`;
  } else {
    summaryText = `We respectfully dispute this claim and present the available evidence below. While some supporting evidence is limited, we believe the evidence provided demonstrates our good-faith fulfillment of this order.`;
  }

  sections.push({
    id: "summary",
    type: "summary",
    text: summaryText,
    evidenceRefs: [],
  });

  // One section per counterclaim
  for (const claim of argumentMap.counterclaims) {
    const supportingRefs = claim.supporting.map((s) => s.field);
    const evidencePhrases = supportingRefs.map(evidencePhrase);

    let claimText: string;
    if (claim.supporting.length > 0) {
      const evidenceList = evidencePhrases.join(", ");
      claimText = `${claim.title}. As demonstrated by ${evidenceList}, this claim is well-supported.`;

      if (claim.missing.length > 0) {
        const missingLabels = claim.missing.map((m) => m.label).join(", ");
        claimText += ` While ${missingLabels} ${claim.missing.length === 1 ? "is" : "are"} not available, the existing evidence provides sufficient support for this argument.`;
      }
    } else {
      claimText = `${claim.title}. We acknowledge that direct evidence for this claim is limited, but we maintain our position based on the overall context of this transaction.`;
    }

    sections.push({
      id: claim.id,
      type: "claim",
      claimId: claim.id,
      text: claimText,
      evidenceRefs: supportingRefs,
    });
  }

  // Conclusion
  const conclusionText =
    argumentMap.overallStrength === "strong" || argumentMap.overallStrength === "moderate"
      ? "Based on the evidence presented above, we respectfully request that this dispute be resolved in our favor. The evidence demonstrates that the transaction was legitimate and the order was fulfilled in accordance with our stated policies."
      : "We have provided all available evidence supporting our position. We respectfully request that this evidence be considered in the resolution of this dispute.";

  sections.push({
    id: "conclusion",
    type: "conclusion",
    text: conclusionText,
    evidenceRefs: [],
  });

  return {
    sections,
    source: "generated",
  };
}

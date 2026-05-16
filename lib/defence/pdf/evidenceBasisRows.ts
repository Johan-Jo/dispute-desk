/**
 * Deterministic "Evidence Basis" row builder.
 *
 * The PDF's Evidence Basis section is rendered directly from approved
 * facts — the LLM does not write it. This module is the single source of
 * truth for which facts appear and in what order.
 *
 * Selection: bankEligible && includeInBankNarrative && !submissionRisk.
 * Ordering: by category-rank then label, so two builds with identical
 * facts produce identical rows.
 */

import type { EvidenceBasisRow, EvidenceFact, EvidenceFactCategory } from "../types";

const CATEGORY_ORDER: EvidenceFactCategory[] = [
  "payment_authentication",
  "payment_auth",
  "billing_match",
  "delivery_proof",
  "shipping_tracking",
  "digital_access_log",
  "service_access",
  "customer_communication",
  "communication",
  "prior_customer_history",
  "account_history",
  "order_record",
  "policy_acceptance",
  "policy_refund",
  "policy_shipping",
  "policy_cancellation",
  "refund_record",
  "subscription_terms",
  "duplicate_explanation",
  "manual_evidence",
  // Buckets that should never reach this list under default classification:
  "ip_location",
  "device_session",
  "fraud_screening",
];

function categoryRank(c: EvidenceFactCategory): number {
  const idx = CATEGORY_ORDER.indexOf(c);
  return idx === -1 ? 999 : idx;
}

function renderValue(fact: EvidenceFact): string {
  const v = fact.value;
  switch (fact.category) {
    case "payment_authentication":
    case "payment_auth": {
      const avs = v?.avsResult;
      const cvv = v?.cvvResult;
      const threeDS = v?.threeDS === true;
      const parts: string[] = [];
      if (typeof avs === "string") parts.push(`AVS ${avs}`);
      if (typeof cvv === "string") parts.push(`CVV ${cvv}`);
      if (threeDS) parts.push("3DS authenticated");
      return parts.length ? parts.join(" • ") : "Authenticated";
    }
    case "billing_match":
      return v?.match === true ? "MATCH" : "Confirmed";
    case "delivery_proof":
    case "shipping_tracking": {
      const proof = typeof v?.proofType === "string" ? (v.proofType as string) : null;
      const at = typeof v?.deliveredAt === "string" ? (v.deliveredAt as string) : null;
      if (proof === "signature_confirmed") return at ? `Signature on delivery, ${at}` : "Signature on delivery";
      if (proof === "delivered_confirmed") return at ? `Delivered ${at}` : "Delivered";
      if (proof === "delivered_unverified") return "In transit / handed to carrier";
      return "Confirmed";
    }
    case "customer_communication":
    case "communication": {
      const at = typeof v?.lastMessageAt === "string" ? (v.lastMessageAt as string) : null;
      return v?.customerConfirmsOrder === true
        ? at
          ? `Customer confirmed order, ${at}`
          : "Customer confirmed order"
        : at
          ? `Communication on file, last ${at}`
          : "Communication on file";
    }
    case "prior_customer_history":
    case "account_history": {
      const count = typeof v?.priorOrderCount === "number" ? v.priorOrderCount : 0;
      return count > 0 ? `${count} prior order${count === 1 ? "" : "s"}` : "Confirmed";
    }
    case "policy_refund":
    case "policy_shipping":
    case "policy_cancellation":
    case "policy_acceptance":
      return v?.acceptedAtCheckout === true ? "Accepted at checkout" : "On record";
    case "order_record":
      return typeof v?.fulfillmentStatus === "string"
        ? `Order on record (${v.fulfillmentStatus})`
        : "Order on record";
    case "refund_record":
      return v?.refundStatus === "processed" ? "Refund processed" : "On record";
    case "duplicate_explanation":
      return "Distinct transaction";
    case "manual_evidence":
      return typeof v?.fileType === "string" ? `Uploaded (${v.fileType})` : "Uploaded";
    default:
      return "Confirmed";
  }
}

export function buildEvidenceBasisRows(facts: EvidenceFact[]): EvidenceBasisRow[] {
  const filtered = facts.filter(
    (f) => f.bankEligible && f.includeInBankNarrative && !f.submissionRisk,
  );
  const sorted = [...filtered].sort((a, b) => {
    const r = categoryRank(a.category) - categoryRank(b.category);
    if (r !== 0) return r;
    return a.label.localeCompare(b.label);
  });
  return sorted.map((f) => ({
    factId: f.id,
    category: f.category,
    label: f.label,
    value: renderValue(f),
  }));
}

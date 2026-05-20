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
      // Prefer the pre-translated verificationSummary built by
      // factClassifier.ts — bank-readable plain language, e.g.
      // "billing address matched • CVV matched". Never quote the raw
      // single-letter gateway codes (Y/M/N/etc.) in evidence basis
      // rows — same rule the LLM narrative obeys.
      const summary =
        typeof v?.verificationSummary === "string" && v.verificationSummary
          ? (v.verificationSummary as string)
          : null;
      const threeDS = v?.threeDS === true;
      if (summary) {
        const parts = [summary];
        if (threeDS) parts.push("3DS authenticated");
        return parts.join(" • ");
      }
      // Fallback for old facts that predate verificationSummary:
      // translate the codes inline rather than print them raw.
      const avs = v?.avsResult;
      const cvv = v?.cvvResult;
      const parts: string[] = [];
      if (typeof avs === "string" && avs.toUpperCase() === "Y") {
        parts.push("billing address matched");
      } else if (
        typeof avs === "string" &&
        (avs.toUpperCase() === "Z" || avs.toUpperCase() === "W")
      ) {
        parts.push("billing postal code matched");
      }
      if (typeof cvv === "string" && cvv.toUpperCase() === "M") {
        parts.push("CVV matched");
      }
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
      // Do NOT echo the raw Shopify fulfillmentStatus (UNFULFILLED /
      // FULFILLED / PARTIAL) — same rule the LLM narrative obeys
      // (claimGuards.ts / FORBIDDEN_PHRASES). The Evidence Basis row
      // states the existence of the order record; the bank-facing
      // argument lives in the narrative, not in the table cell.
      return "Order on record";
    case "refund_record":
      return v?.refundStatus === "processed" ? "Refund processed" : "On record";
    case "duplicate_explanation":
      return "Distinct transaction";
    case "manual_evidence":
      return typeof v?.fileType === "string" ? `Uploaded (${v.fileType})` : "Uploaded";
    case "fraud_screening": {
      // Source-collector pre-gates: only LOW/NONE + ACCEPT + ≥1
      // positive fact reach this branch. Render the recommendation
      // verdict followed by the actual signals Shopify returned, so
      // the bank reviewer can audit what the screening looked at.
      //
      // Pre-2026-05-19 this rendered "N positive signals" with no
      // names — meaningless for a reviewer. The fact value now
      // carries the specific phrases (`positiveFacts: string[]`)
      // since factClassifier passes them through.
      const facts = Array.isArray(v?.positiveFacts)
        ? (v.positiveFacts as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      if (facts.length > 0) {
        // Print every signal Shopify returned — the bank reviewer
        // needs to see them all; a "+N more" suffix hides the
        // signals that justify the verdict. The source-collector
        // caps positiveFacts at MAX_POSITIVE_FACTS_CITED upstream,
        // so the list cannot grow unbounded.
        return `Shopify recommended ACCEPT — ${facts.join("; ")}`;
      }
      // Fallback for legacy facts that only carried the count.
      const count =
        typeof v?.positiveFactCount === "number" ? v.positiveFactCount : 0;
      if (count >= 1) {
        return `Shopify recommended ACCEPT · ${count} positive signal${
          count === 1 ? "" : "s"
        }`;
      }
      return "Shopify recommended ACCEPT";
    }
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

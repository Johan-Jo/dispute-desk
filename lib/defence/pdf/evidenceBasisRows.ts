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
import { formatChronologyTimestamp } from "../chronology";

const CATEGORY_ORDER: EvidenceFactCategory[] = [
  "payment_authentication",
  "payment_auth",
  "billing_match",
  // ip_location is bank-facing when the collector's `bankEligible`
  // gate is satisfied (clean match, no VPN/proxy/hosting, consistent
  // IP). Ordered here alongside the other identity signals.
  "ip_location",
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
      const rawAt = typeof v?.deliveredAt === "string" ? (v.deliveredAt as string) : null;
      // Format the carrier timestamp as a clean bank-facing date instead of
      // the raw ISO string ("2026-07-06T18:16:00Z" → "Jul 6, 2026, 18:16 UTC").
      const at = rawAt ? formatChronologyTimestamp(rawAt) : null;
      // Carrier + tracking number + the carrier's own tracking URL are the
      // identifiers an issuer needs to VERIFY a delivery claim; without them
      // "Delivered <date>" is an unsupported assertion. Blume-box #345920's
      // issuer response asked for precisely this: "a tracking number or
      // tracking details that show the order was successfully delivered."
      //
      // The URL is printed too, not just the number: an issuer reviewing the
      // packet should be able to check the parcel on the carrier's own site
      // without first working out which carrier's format the number belongs
      // to. Appended to every proof state — including in-transit, where
      // looking it up is the whole point.
      const carrier = typeof v?.carrier === "string" ? (v.carrier as string).trim() : "";
      const number = typeof v?.trackingNumber === "string" ? (v.trackingNumber as string).trim() : "";
      const url = typeof v?.trackingUrl === "string" ? (v.trackingUrl as string).trim() : "";
      const ref = [[carrier, number].filter(Boolean).join(" "), url]
        .filter(Boolean)
        .join(" · ");
      const withRef = (base: string) => (ref ? `${base} · ${ref}` : base);
      if (proof === "signature_confirmed") {
        return withRef(at ? `Signature on delivery, ${at}` : "Signature on delivery");
      }
      if (proof === "delivered_confirmed") return withRef(at ? `Delivered ${at}` : "Delivered");
      if (proof === "delivered_unverified") return withRef("In transit / handed to carrier");
      return withRef("Confirmed");
    }
    case "customer_communication":
    case "communication": {
      const rawMsgAt = typeof v?.lastMessageAt === "string" ? (v.lastMessageAt as string) : null;
      const at = rawMsgAt ? formatChronologyTimestamp(rawMsgAt) : null;
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
      // Only bank-eligible facts reach this renderer (filtered upstream
      // in buildEvidenceBasisRows). For customer_account_info that
      // means `categorizeEvidenceField` returned "strong" / "moderate"
      // — i.e. the customer has >=1 prior order. First-time-customer
      // facts are categorized as supporting and never bank-eligible,
      // so they never appear here.
      const count = typeof v?.priorOrderCount === "number" ? v.priorOrderCount : 0;
      // Tri-state — see disputeFreeHistoryState. The word "undisputed"
      // is only printed on a VERIFIED clean history; an unverified one
      // states the count and stops there. `!== false` used to print
      // "N prior undisputed orders" on every unchecked account.
      const disputeFree =
        v?.disputeFreeHistory === true
          ? "dispute_free"
          : v?.disputeFreeHistory === false
            ? "has_disputes"
            : "unknown";
      if (count >= 1 && disputeFree === "dispute_free") {
        return `${count} prior undisputed order${count === 1 ? "" : "s"}`;
      }
      if (count >= 1 && disputeFree === "has_disputes") {
        return `${count} prior order${count === 1 ? "" : "s"} (account has prior chargebacks)`;
      }
      if (count >= 1) {
        return `${count} prior order${count === 1 ? "" : "s"} on this account`;
      }
      // Defensive fallback for legacy / hand-rolled facts that bypassed
      // the categorizer gate. The earlier "Confirmed" string was vague;
      // be explicit so a bad row is debuggable instead of silently misleading.
      return "Prior account history on file";
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
    case "ip_location": {
      // Only bank-eligible facts reach this renderer (filtered upstream
      // in buildEvidenceBasisRows). For ip_location that means the
      // collector's pre-computed `bankEligible` was true — i.e. the
      // location matched, no VPN/proxy/hosting, and the IP history is
      // consistent. Cell text is deliberately country-grained, never
      // city or coordinate — same rule the collector follows.
      const match = typeof v?.locationMatch === "string" ? v.locationMatch : null;
      if (match === "same_city") {
        return "IP geolocation matches the billing/shipping region";
      }
      if (match === "same_country") {
        return "IP geolocation matches the billing/shipping country";
      }
      return "IP geolocation consistent with the cardholder's location";
    }
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

// Capitalize the first character of an Evidence Basis cell value. The
// upstream classifier produces phrases that read naturally mid-sentence
// inside the LLM narrative ("the billing address matched…"), but the
// PDF table cell is its own sentence-equivalent and must start with a
// capital letter. Applied at the renderer boundary so every category's
// cell text obeys the rule without touching the narrative-facing
// source strings.
function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The delivery signal reaches the classifier under two sibling
// categories — `delivery_proof` and `shipping_tracking` — carrying the
// SAME fulfillment payload (proofType, deliveredAt, …). Left alone,
// buildEvidenceBasisRows emits two Evidence Basis rows that render an
// identical value (e.g. "Delivery confirmation → Delivered Jul 7" and
// "Shipping tracking → Delivered Jul 7"), printing the same fact twice.
//
// The UI line-item surfaces already collapse this pair upstream
// (`deriveEvidenceLineItems`, tests/unit/deliveryRowCollapse.test.ts);
// the PDF's Evidence Basis table is the one place that did not. Keep the
// higher-ranked `delivery_proof` row (it sorts first and carries the
// proof-oriented "Delivery confirmation" label) and drop the sibling
// `shipping_tracking` row when both survive filtering. If only one of the
// pair is present, it is kept as-is.
function collapseDeliveryPair(facts: EvidenceFact[]): EvidenceFact[] {
  const hasDeliveryProof = facts.some((f) => f.category === "delivery_proof");
  if (!hasDeliveryProof) return facts;
  return facts.filter((f) => f.category !== "shipping_tracking");
}

export function buildEvidenceBasisRows(facts: EvidenceFact[]): EvidenceBasisRow[] {
  const filtered = collapseDeliveryPair(
    facts.filter(
      (f) => f.bankEligible && f.includeInBankNarrative && !f.submissionRisk,
    ),
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
    value: capitalizeFirst(renderValue(f)),
  }));
}

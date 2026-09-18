/**
 * Deterministic "Evidence Basis" row builder.
 *
 * The PDF's Evidence Basis section is rendered directly from approved
 * facts — the LLM does not write it. This module is the single source of
 * truth for which facts appear and in what order.
 *
 * Selection: bankEligible && includeInBankNarrative && !submissionRisk, AND
 * the fact must have something citable to say — `renderValue` returning null
 * suppresses the ROW, not just its text.
 * Ordering: by category-rank then label, so two builds with identical
 * facts produce identical rows.
 */

import type { EvidenceBasisRow, EvidenceFact, EvidenceFactCategory } from "../types";
import { bankIncludedFacts } from "../bankInclusion";
import { formatChronologyTimestamp } from "../chronology";
import {
  citableVerificationPartsEn,
  citableVerificationSummaryEn,
  readPaymentVerification,
} from "@/lib/argument/paymentVerification";
import { trackingLinkUrl } from "@/lib/carriers/trackingLinkUrl";

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

/**
 * The cell text for one fact, or **null when the fact has nothing citable to
 * say** — in which case the caller emits no row at all.
 *
 * Only the payment-authentication branch can return null today. Every other
 * category reaching this renderer has content by construction.
 */
function renderValue(fact: EvidenceFact): string | null {
  const v = fact.value;
  switch (fact.category) {
    case "payment_authentication":
    case "payment_auth": {
      // AUTHORITY COMES FROM THE VALUES, NEVER FROM THE PERSISTED PHRASE.
      //
      // `verificationSummary` is a rendering of a decision, not the decision.
      // Facts written before PR-C2 carry summaries built under the old rule —
      // including "the card verification code matched the issuer's records"
      // on a CVV-only case, and "the billing postal code matched…" on AVS `Z`
      // — and those rows also carry `bankEligible: true` from the same era.
      // Trusting the stored sentence let exactly the claim this containment
      // withdraws walk back into the letter on a re-render.
      //
      // So the underlying codes are read FIRST, through the one owner, and
      // decide whether anything may be said at all. Only then does a stored
      // summary matter — and then only as a signal of which register to write
      // in, never as content.
      const verification = readPaymentVerification(v);
      const hasPersistedSummary =
        typeof v?.verificationSummary === "string" &&
        (v.verificationSummary as string).trim().length > 0;
      const threeDS = v?.threeDS === true;
      // Only a fact the classifier deemed citable reaches this renderer (see
      // `isUnciteableThreeDs`), so a 3DS mention here is liability-shifted or
      // merchant-confirmed. Name the ECI and the DS transaction id with it:
      // the issuer can match that id against their own authentication record,
      // which is what separates a verifiable fact from an adjective.
      const threeDsDetail = (): string => {
        const eci = typeof v?.eci === "string" ? (v.eci as string).trim() : "";
        const ds = typeof v?.dsTransactionId === "string" ? (v.dsTransactionId as string).trim() : "";
        const bits = ["3DS authenticated"];
        if (eci) bits.push(`ECI ${eci}`);
        if (ds) bits.push(`DS transaction ${ds}`);
        return bits.join(", ");
      };
      // Every word of AVS/CVV text is DERIVED from the values that just
      // authorized it. A fact whose address half is missing or uncitable
      // contributes nothing here, whatever its stored summary says.
      //
      // The two registers are the historical ones and are preserved so
      // existing packages re-render identically: a fact that carried a
      // summary gets the sentence form, a raw-code fact gets the terse
      // "billing address matched • CVV matched" form.
      const parts: string[] = [];
      if (verification.citable) {
        const derived = hasPersistedSummary
          ? citableVerificationSummaryEn(verification)
          : citableVerificationPartsEn(verification).join(" • ");
        if (derived) parts.push(derived);
      }

      // 3-D Secure is an INDEPENDENT citable fact: an authentication with a
      // liability shift stands on its own and must still render, whether or
      // not an AVS result exists. `isUnciteableThreeDsFact` upstream already
      // withheld the "attempted"/exempted cases, so a `threeDS` that reaches
      // here is one we may cite.
      if (threeDS) parts.push(threeDsDetail());

      // NOTHING CITABLE → NO ROW (PR-C2 review, 2026-08-08).
      //
      // This used to return the bare word "Authenticated". On a legacy
      // CVV-only fact — where the address half is missing and there is no
      // 3DS — that printed an unsupported assertion of authentication to the
      // issuer, and it printed it under a row whose label reads "Payment
      // authentication". Stripping the words "CVV" and "verification code"
      // was not enough: the row itself was the claim. A fact with no citable
      // content is not summarized more vaguely, it is not shown.
      //
      // Facts built by the current classifier never get here (a CVV-only
      // fact is already `bankEligible: false`). This closes the path for a
      // persisted fact whose stale flags say otherwise.
      return parts.length ? parts.join(" • ") : null;
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
      // Carrier + number stay in the TEXT — they are the identifiers, and
      // they must survive a printed page and a link that has gone stale.
      //
      // The URL does NOT. It moves to the row's `link`, which both renderers
      // turn into a real clickable anchor (`<Link>` in the PDF, `<a>` in the
      // HTML preview) whose visible text is the carrier + number. Pasting the
      // raw URL into the value here is what produced the dead 120-character
      // DHL string a reviewer had to select, copy and paste by hand; the link
      // is a convenience for a busy reader, and a convenience that takes three
      // manual steps is not one.
      const carrier = typeof v?.carrier === "string" ? (v.carrier as string).trim() : "";
      const number = typeof v?.trackingNumber === "string" ? (v.trackingNumber as string).trim() : "";
      // The carrier + number appears EXACTLY ONCE. When a link exists it is
      // the link's anchor text, so repeating it here printed it twice
      // ("… · TechSHIP 4207… · TechSHIP 4207…"). When there is no link, it
      // must still appear as plain text — it is the identifier that makes the
      // delivery claim verifiable, and it has to survive a printed page.
      const ref = renderLink(fact) ? "" : [carrier, number].filter(Boolean).join(" ");
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

/**
 * The row's clickable tracking link, or null.
 *
 * NOT the merchant's raw URL. `resolveTrackingLinkUrl` rebuilds the link from
 * the carrier's canonical deep-link format so it opens the shipment's RESULT
 * page, and returns null rather than emit a link that opens an empty search
 * box — which an issuer reads as "no proof of delivery", the opposite of what
 * this row asserts.
 *
 * Anchor text is carrier + number so the reader sees what they are opening and
 * the raw URL never has to appear. Falls back to the number alone, and finally
 * to a generic label, so a link is never anchored on empty text.
 */
function renderLink(f: EvidenceFact): EvidenceBasisRow["link"] {
  if (f.category !== "delivery_proof" && f.category !== "shipping_tracking") return null;
  const v = f.value as Record<string, unknown> | null;
  const carrier = typeof v?.carrier === "string" ? v.carrier.trim() : "";
  const number = typeof v?.trackingNumber === "string" ? v.trackingNumber.trim() : "";
  const url = trackingLinkUrl({
    company: carrier,
    number,
    url: typeof v?.trackingUrl === "string" ? v.trackingUrl : null,
  });
  if (!url) return null;
  const label = [carrier, number].filter(Boolean).join(" ") || "Track this shipment";
  return { url, label };
}

export function buildEvidenceBasisRows(facts: EvidenceFact[]): EvidenceBasisRow[] {
  // The ONE bank-inclusion predicate (`lib/defence/bankInclusion.ts`). The rule
  // used to be spelled inline here, in the classifier, in the workspace route
  // and — differently — in the LLM payload filter; delegating is what lets
  // `tests/unit/bankInclusionSingleOwner.test.ts` prove there is one owner.
  const filtered = collapseDeliveryPair(bankIncludedFacts(facts));
  const sorted = [...filtered].sort((a, b) => {
    const r = categoryRank(a.category) - categoryRank(b.category);
    if (r !== 0) return r;
    return a.label.localeCompare(b.label);
  });
  const rows: EvidenceBasisRow[] = [];
  for (const f of sorted) {
    const value = renderValue(f);
    // A fact with nothing citable to say produces NO row — the row's own
    // label is an assertion, so an empty-but-present row is still a claim.
    if (value === null) continue;
    rows.push({
      factId: f.id,
      category: f.category,
      label: f.label,
      value: capitalizeFirst(value),
      link: renderLink(f),
    });
  }
  return rows;
}

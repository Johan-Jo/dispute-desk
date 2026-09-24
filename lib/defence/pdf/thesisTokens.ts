/**
 * Thesis tokens — pure extractors over approved facts.
 *
 * Each token is a name + an extractor function (facts → string|null).
 * Extractors NEVER see internal-only facts — the classifier filter
 * runs upstream and the composed-validator catches any leak — so a
 * token cannot accidentally surface IP-mismatch, AVS-failure, or
 * fraud-risk-screening data in a bank-facing thesis.
 *
 * Most tokens carry a `predicateId`: the token may only resolve when
 * the predicate evaluates true. This is the structural guarantee
 * behind Phase 4's safety — a 3-D Secure clause cannot appear in a
 * thesis unless `three_d_secure_present` is true.
 */

import {
  hasCitableAddressMatch,
  readPaymentVerification,
} from "@/lib/argument/paymentVerification";
import { FACT_PREDICATES } from "../factPredicates";

const LETTER_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "24 September 2026" (UTC) — the bank reads a date, never the raw ISO
 *  timestamp the fact stores ("on 2026-09-24T19:43:25Z", #360980). */
export function letterDate(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${LETTER_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
import type {
  EvidenceFact,
  ThesisContext,
  ThesisToken,
  ThesisTokenName,
} from "../types";

function findFact(
  facts: EvidenceFact[],
  category: EvidenceFact["category"],
): EvidenceFact | null {
  return facts.find((f) => f.category === category) ?? null;
}

/** Build a token whose `extract` short-circuits to null whenever the
 *  predicate is false. The check is duplicated belt-and-braces with the
 *  required-token gate in renderThesis — a token cannot leak into
 *  prose just because someone forgot to mark it as required. */
function gated(
  spec: Omit<ThesisToken, "extract"> & { extract: ThesisToken["extract"] },
): ThesisToken {
  const guard = spec.predicateId
    ? FACT_PREDICATES[spec.predicateId]
    : null;
  return {
    ...spec,
    extract: (facts, ctx) => {
      if (guard && !guard.evaluate(facts)) return null;
      return spec.extract(facts, ctx);
    },
  };
}

const DELIVERED_TIERS = new Set(["delivered_confirmed", "signature_confirmed", "signature"]);

/**
 * The carrier-recorded delivery a letter can open with: carrier, tracking
 * number (only when the reference IS one), delivery time, signature. On a
 * multi-parcel order it is the delivered PARCEL, never the order — "a
 * shipment", so the sentence stays true while another parcel is in transit.
 */
function carrierDelivery(facts: EvidenceFact[]): {
  carrier: string | null;
  tracking: string | null;
  deliveredAt: string | null;
  signed: boolean;
  oneOfSeveral: boolean;
} | null {
  const d = findFact(facts, "delivery_proof") ?? findFact(facts, "shipping_tracking");
  if (!d) return null;
  const v = (d.value ?? {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const shipments = Array.isArray(v.shipments) ? (v.shipments as Array<Record<string, unknown>>) : [];
  if (shipments.length > 1) {
    const s = shipments.find((p) => DELIVERED_TIERS.has(String(p.proofType)) && str(p.deliveredAt));
    if (!s) return null;
    return {
      carrier: str(s.carrier),
      tracking: s.referenceIsTrackingNumber === true ? str(s.reference) : null,
      deliveredAt: str(s.deliveredAt),
      signed: String(s.proofType).startsWith("signature"),
      oneOfSeveral: true,
    };
  }
  if (!DELIVERED_TIERS.has(String(v.proofType))) return null;
  return {
    carrier: str(v.carrier),
    tracking: str(v.trackingNumber),
    deliveredAt: str(v.deliveredAt),
    signed: String(v.proofType).startsWith("signature"),
    oneOfSeveral: false,
  };
}

export const THESIS_TOKENS: Record<ThesisTokenName, ThesisToken> = {
  /* The item-not-received opening line (2026-09-24, reviewer of #352543:
   * "lead directly with the carrier-confirmed delivery and the later dispute
   * date"). States the record, attributed to the carrier once. */
  deliveryRecordClause: gated({
    name: "deliveryRecordClause",
    description: "The carrier's delivery record: \"Stallion Express recorded the shipment for order #352543 (tracking 260702441A) as delivered on 6 July 2026\". Null without a carrier-confirmed delivery.",
    predicateId: "delivery_confirmed",
    extract: (facts, ctx?: ThesisContext) => {
      const r = carrierDelivery(facts);
      if (!r) return null;
      const order = ctx?.orderName ? ` for order ${ctx.orderName}` : "";
      const tracking = r.tracking ? ` (tracking ${r.tracking})` : "";
      const date = letterDate(r.deliveredAt);
      return (
        `${r.carrier ?? "The carrier"} recorded ${r.oneOfSeveral ? "a" : "the"} shipment${order}${tracking} as delivered` +
        `${r.signed ? ", with a signature," : ""}${date ? ` on ${date}` : ""}`
      );
    },
  }),

  /* The dispute date — stated ONLY when the delivery came first. A delivery
   * after the dispute opened is still delivery, but setting the two dates
   * side by side would point the reader at the gap (merchant's counsel). */
  disputeOpenedClause: gated({
    name: "disputeOpenedClause",
    description: "\"the dispute was opened on 19 September 2026\" — only when the carrier-recorded delivery predates it.",
    predicateId: "delivery_confirmed",
    extract: (facts, ctx?: ThesisContext) => {
      const opened = ctx?.disputeOpenedAt ?? null;
      const r = carrierDelivery(facts);
      if (!opened || !r?.deliveredAt) return null;
      const o = Date.parse(opened);
      const del = Date.parse(r.deliveredAt);
      if (Number.isNaN(o) || Number.isNaN(del) || del >= o) return null;
      const date = letterDate(opened);
      return date ? `the dispute was opened on ${date}` : null;
    },
  }),

  paymentAuthMethod: gated({
    name: "paymentAuthMethod",
    description: "Describes the authentication method present on the transaction (3-D Secure, AVS+CVV match, AVS-only, CVV-only). Null when no auth fact qualifies.",
    predicateId: "is_card_absent_dispute",
    extract: (facts) => {
      // 3-D Secure beats AVS/CVV when both are present.
      if (FACT_PREDICATES.three_d_secure_present.evaluate(facts)) {
        return FACT_PREDICATES.liability_shift_present.evaluate(facts)
          ? "3-D Secure authentication with liability shift"
          : "3-D Secure authentication";
      }
      if (FACT_PREDICATES.avs_and_cvv_match.evaluate(facts)) {
        return "AVS and CVV match";
      }
      // Partial. PR-C2 (C-12) decision 1: an AVS match still describes the
      // authentication method; a CVV-ONLY match does not reach an issuer at
      // all, so this token stays null for it. The "CVV match" arm that used to
      // live here was a bank-facing citation of exactly the fact the
      // containment withdraws.
      // A citable (network, code) cell — not a bare letter (PR-C3). A Visa
      // `M` names the same rule as `Y`; a `Y` on a network whose document we
      // have never read names none.
      const auth = findFact(facts, "payment_authentication");
      if (auth && hasCitableAddressMatch(readPaymentVerification(auth.value))) {
        return "AVS match";
      }
      return null;
    },
  }),

  priorOrderHistoryClause: gated({
    name: "priorOrderHistoryClause",
    description: "A natural-language clause about prior undisputed orders. Null when no prior_customer_history fact with priorOrderCount > 0.",
    predicateId: "prior_customer",
    extract: (facts) => {
      const ph =
        findFact(facts, "prior_customer_history") ??
        findFact(facts, "account_history");
      const count = ph?.value?.priorOrderCount;
      if (typeof count !== "number" || count <= 0) return null;
      const noun = count === 1 ? "prior undisputed order" : "prior undisputed orders";
      return `the cardholder has ${count} ${noun} with the merchant`;
    },
  }),

  customerCommunicationClause: gated({
    name: "customerCommunicationClause",
    description: "A natural-language clause about documented customer communication. Null when no customer_communication / communication fact.",
    predicateId: "customer_communication_on_record",
    extract: (facts) => {
      const c =
        findFact(facts, "customer_communication") ??
        findFact(facts, "communication");
      if (!c) return null;
      const confirms = c.value?.customerConfirmsOrder === true;
      if (confirms) return "the customer's correspondence on record acknowledges the order";
      return "the customer's correspondence with the merchant is on record";
    },
  }),

  digitalAccessClause: gated({
    name: "digitalAccessClause",
    description: "A natural-language clause about confirmed digital access use. Null otherwise.",
    predicateId: "digital_access_used",
    extract: (facts) => {
      const d =
        findFact(facts, "digital_access_log") ??
        findFact(facts, "service_access");
      if (!d) return null;
      const at = letterDate(d.value?.lastAccessAt);
      return at
        ? `the customer's access to the service is logged through ${at}`
        : "the customer's access to the service is logged";
    },
  }),

  refundProcessedClause: gated({
    name: "refundProcessedClause",
    description: "A natural-language clause confirming a refund was processed. Null otherwise.",
    predicateId: "refund_processed",
    extract: (facts) => {
      const r = findFact(facts, "refund_record");
      if (!r) return null;
      return "a refund has been processed on this charge";
    },
  }),

  policyDisclosureClause: gated({
    name: "policyDisclosureClause",
    description: "A natural-language clause about which policies were disclosed at checkout. Null when no policy_* facts.",
    predicateId: "policy_disclosed",
    extract: (facts) => {
      const disclosed: string[] = [];
      if (findFact(facts, "policy_refund")) disclosed.push("refund");
      if (findFact(facts, "policy_shipping")) disclosed.push("shipping");
      if (findFact(facts, "policy_cancellation")) disclosed.push("cancellation");
      if (disclosed.length === 0) return null;
      const list =
        disclosed.length === 1
          ? disclosed[0]
          : disclosed.length === 2
            ? `${disclosed[0]} and ${disclosed[1]}`
            : `${disclosed.slice(0, -1).join(", ")}, and ${disclosed[disclosed.length - 1]}`;
      return `the merchant's ${list} policies were published and available to the customer at checkout`;
    },
  }),

  reasonCodeContext: {
    name: "reasonCodeContext",
    description:
      "Descriptive (not assertive) reference to the dispute reason. Always available — falls back to a generic phrase. Never asserts the reason as a merchant-held fact.",
    predicateId: null,
    extract: () => "the chargeback identified above",
  },
};

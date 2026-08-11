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
import type {
  EvidenceFact,
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
    extract: (facts) => {
      if (guard && !guard.evaluate(facts)) return null;
      return spec.extract(facts);
    },
  };
}

export const THESIS_TOKENS: Record<ThesisTokenName, ThesisToken> = {
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

  deliveryClause: gated({
    name: "deliveryClause",
    description: "A natural-language clause about confirmed delivery (proofType=delivered_confirmed/signature_confirmed). Null otherwise.",
    predicateId: "delivery_confirmed",
    extract: (facts) => {
      const d =
        findFact(facts, "delivery_proof") ??
        findFact(facts, "shipping_tracking");
      if (!d) return null;
      const proofType = d.value?.proofType;
      const deliveredAt = typeof d.value?.deliveredAt === "string" ? d.value.deliveredAt : null;
      const carrier = typeof d.value?.carrier === "string" ? d.value.carrier : null;
      if (proofType === "signature_confirmed" || proofType === "signature") {
        return carrier
          ? `delivery was confirmed via carrier signature${deliveredAt ? ` on ${deliveredAt}` : ""} (${carrier})`
          : `delivery was confirmed via carrier signature${deliveredAt ? ` on ${deliveredAt}` : ""}`;
      }
      // carrier-confirmed delivery without a captured signature
      return carrier
        ? `delivery was confirmed by the carrier${deliveredAt ? ` on ${deliveredAt}` : ""} (${carrier})`
        : `delivery was confirmed by the carrier${deliveredAt ? ` on ${deliveredAt}` : ""}`;
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
      const at = typeof d.value?.lastAccessAt === "string" ? d.value.lastAccessAt : null;
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

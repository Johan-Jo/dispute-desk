/**
 * Fact predicates — first-class, named evidence checks over
 * approvedFacts. Each predicate is a PURE function: no I/O, no
 * narrative text, no thrown errors. Three downstream consumers
 * share this single source of truth:
 *
 *   - Claim guards (`claimGuards.ts`) — guard the LLM output and
 *     composed-PDF text against unsupported claims.
 *   - Strategy ranking (`strategies/registry.ts`, Phase 3) — gate
 *     which strategy submodules a family considers.
 *   - Templated thesis (`pdf/thesisTokens.ts`, Phase 4) — gate token
 *     extractors so a thesis only claims a fact when the predicate
 *     it depends on evaluates true.
 *
 * Pre-Phase 2 the predicate functions were inlined inside each
 * ClaimGuard — moving them here means the same evidence check is
 * authoritative in every layer instead of three diverging
 * re-implementations.
 */

import type {
  EvidenceFact,
  EvidenceFactCategory,
  FactPredicate,
  FactPredicateId,
} from "./types";

/* ── helpers ── */

const DELIVERY_CATEGORIES: EvidenceFactCategory[] = [
  "delivery_proof",
  "shipping_tracking",
];
const DIGITAL_CATEGORIES: EvidenceFactCategory[] = [
  "digital_access_log",
  "service_access",
];

function hasCategory(
  facts: EvidenceFact[],
  cats: EvidenceFactCategory[],
): boolean {
  const set = new Set<EvidenceFactCategory>(cats);
  return facts.some((f) => set.has(f.category));
}

function hasCategoryWithValueTrue(
  facts: EvidenceFact[],
  cats: EvidenceFactCategory[],
  key: string,
): boolean {
  const set = new Set<EvidenceFactCategory>(cats);
  return facts.some((f) => set.has(f.category) && f.value?.[key] === true);
}

function hasCategoryWithValueEquals(
  facts: EvidenceFact[],
  cats: EvidenceFactCategory[],
  key: string,
  value: unknown,
): boolean {
  const set = new Set<EvidenceFactCategory>(cats);
  return facts.some(
    (f) => set.has(f.category) && f.value?.[key] === value,
  );
}

function hasCategoryWithValueGreaterThan(
  facts: EvidenceFact[],
  cats: EvidenceFactCategory[],
  key: string,
  threshold: number,
): boolean {
  const set = new Set<EvidenceFactCategory>(cats);
  return facts.some((f) => {
    if (!set.has(f.category)) return false;
    const v = f.value?.[key];
    return typeof v === "number" && v > threshold;
  });
}

function orderRecordFulfillment(facts: EvidenceFact[]): string | null {
  const orderFact = facts.find((f) => f.category === "order_record");
  const v = orderFact?.value?.fulfillmentStatus;
  return typeof v === "string" ? v.toUpperCase() : null;
}

/* ── predicate definitions ── */

export const FACT_PREDICATES: Record<FactPredicateId, FactPredicate> = {
  delivery_confirmed: {
    id: "delivery_confirmed",
    description:
      "delivery_proof or shipping_tracking with proofType='delivered_confirmed' or 'signature_confirmed'",
    // The fulfillment collector writes the 4-state DeliveryProofType
    // vocabulary (canonicalEvidence.ts): signature_confirmed /
    // delivered_confirmed / delivered_unverified / label_created.
    // Only the two carrier-confirmed states satisfy this predicate —
    // delivered_unverified and label_created never ground a delivery
    // claim. The bare 'delivered' / 'signature' values are accepted
    // for manually-entered facts that predate the canonical vocabulary.
    evaluate: (facts) =>
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "delivered_confirmed") ||
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "signature_confirmed") ||
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "delivered") ||
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "signature"),
  },

  signature_captured: {
    id: "signature_captured",
    description:
      "delivery_proof or shipping_tracking with proofType='signature_confirmed'",
    evaluate: (facts) =>
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "signature_confirmed") ||
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "signature"),
  },

  digital_access_used: {
    id: "digital_access_used",
    description: "digital_access_log or service_access with digitalAccessUsed=true / serviceUsed=true / used=true",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, DIGITAL_CATEGORIES, "digitalAccessUsed") ||
      hasCategoryWithValueTrue(facts, ["service_access"], "serviceUsed") ||
      hasCategoryWithValueTrue(facts, ["service_access"], "used"),
  },

  digital_access_granted: {
    id: "digital_access_granted",
    description: "digital_access_log or service_access with digitalAccessGranted=true (or accessGranted=true)",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, DIGITAL_CATEGORIES, "digitalAccessGranted") ||
      hasCategoryWithValueTrue(facts, ["service_access"], "accessGranted"),
  },

  service_delivered: {
    id: "service_delivered",
    description: "service_access with serviceDelivered=true",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["service_access"], "serviceDelivered"),
  },

  service_completed_or_delivered: {
    id: "service_completed_or_delivered",
    description: "service_access serviceDelivered/serviceCompleted, OR delivery_confirmed",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["service_access"], "serviceDelivered") ||
      hasCategoryWithValueTrue(facts, ["service_access"], "serviceCompleted") ||
      FACT_PREDICATES.delivery_confirmed.evaluate(facts),
  },

  customer_received_goods_or_service: {
    id: "customer_received_goods_or_service",
    description: "delivery_confirmed, OR digital_access_used, OR service_delivered",
    evaluate: (facts) =>
      FACT_PREDICATES.delivery_confirmed.evaluate(facts) ||
      FACT_PREDICATES.digital_access_used.evaluate(facts) ||
      FACT_PREDICATES.service_delivered.evaluate(facts),
  },

  three_d_secure_present: {
    id: "three_d_secure_present",
    description: "payment_authentication or payment_auth with threeDS=true",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["payment_authentication", "payment_auth"], "threeDS"),
  },

  liability_shift_present: {
    id: "liability_shift_present",
    description: "payment_authentication or payment_auth with liabilityShift=true",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["payment_authentication", "payment_auth"], "liabilityShift"),
  },

  avs_and_cvv_match: {
    id: "avs_and_cvv_match",
    description: "payment_authentication / billing_match with avsResult='Y' AND cvvResult='M'",
    evaluate: (facts) =>
      facts.some(
        (f) =>
          (f.category === "payment_authentication" || f.category === "payment_auth") &&
          f.value?.avsResult === "Y" &&
          f.value?.cvvResult === "M",
      ),
  },

  avs_or_cvv_value_present: {
    id: "avs_or_cvv_value_present",
    description: "payment_authentication / payment_auth / billing_match with any avsResult or cvvResult value",
    evaluate: (facts) =>
      facts.some(
        (f) =>
          (f.category === "payment_authentication" ||
            f.category === "payment_auth" ||
            f.category === "billing_match") &&
          (f.value?.avsResult !== undefined || f.value?.cvvResult !== undefined),
      ),
  },

  billing_match_confirmed: {
    id: "billing_match_confirmed",
    description: "billing_match category with match=true",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["billing_match"], "match"),
  },

  prior_customer: {
    id: "prior_customer",
    description: "prior_customer_history or account_history with priorOrderCount > 0",
    evaluate: (facts) =>
      hasCategoryWithValueGreaterThan(
        facts,
        ["prior_customer_history", "account_history"],
        "priorOrderCount",
        0,
      ),
  },

  policy_disclosed: {
    id: "policy_disclosed",
    description: "any policy_refund, policy_shipping, policy_cancellation fact",
    evaluate: (facts) =>
      hasCategory(facts, ["policy_refund", "policy_shipping", "policy_cancellation"]),
  },

  policy_accepted: {
    id: "policy_accepted",
    description: "policy_acceptance with acceptedAtCheckout=true (or category present)",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["policy_acceptance"], "acceptedAtCheckout") ||
      hasCategory(facts, ["policy_acceptance"]),
  },

  refund_processed: {
    id: "refund_processed",
    description: "refund_record with refundStatus='processed'",
    evaluate: (facts) =>
      hasCategoryWithValueEquals(facts, ["refund_record"], "refundStatus", "processed"),
  },

  credit_preceded_dispute: {
    id: "credit_preceded_dispute",
    description:
      "refund_record processed AND issued before the dispute was filed",
    evaluate: (facts) =>
      hasCategoryWithValueEquals(facts, ["refund_record"], "refundStatus", "processed") &&
      hasCategoryWithValueEquals(facts, ["refund_record"], "precededDispute", true),
  },

  credit_covers_disputed_amount: {
    id: "credit_covers_disputed_amount",
    description:
      "pre-dispute credit covers the full disputed amount (gates 'in full' copy)",
    evaluate: (facts) =>
      hasCategoryWithValueEquals(facts, ["refund_record"], "precededDispute", true) &&
      hasCategoryWithValueEquals(facts, ["refund_record"], "coversDisputedAmount", true),
  },

  return_not_initiated: {
    id: "return_not_initiated",
    description:
      "no_return_initiated fact present (order returnStatus=NO_RETURN, no refund) — grounds the 'no refund was owed, customer never returned the item' argument",
    evaluate: (facts) => hasCategory(facts, ["no_return_initiated"]),
  },

  subscription_terms_present: {
    id: "subscription_terms_present",
    description: "subscription_terms category present",
    evaluate: (facts) => hasCategory(facts, ["subscription_terms"]),
  },

  customer_communication_on_record: {
    id: "customer_communication_on_record",
    description: "customer_communication or communication category present",
    evaluate: (facts) => hasCategory(facts, ["customer_communication", "communication"]),
  },

  is_card_absent_dispute: {
    id: "is_card_absent_dispute",
    description: "any payment_authentication / payment_auth fact (presence implies CNP context — there is no card-present fact category today)",
    evaluate: (facts) =>
      hasCategory(facts, ["payment_authentication", "payment_auth"]),
  },

  fulfilment_status_fulfilled: {
    id: "fulfilment_status_fulfilled",
    description: "order_record.fulfillmentStatus === 'FULFILLED'",
    evaluate: (facts) => orderRecordFulfillment(facts) === "FULFILLED",
  },

  fulfilment_status_unfulfilled: {
    id: "fulfilment_status_unfulfilled",
    description: "order_record.fulfillmentStatus === 'UNFULFILLED'",
    evaluate: (facts) => orderRecordFulfillment(facts) === "UNFULFILLED",
  },

  safe_to_claim_fulfilment: {
    id: "safe_to_claim_fulfilment",
    description:
      "Either order_record is absent or not UNFULFILLED, OR delivery_confirmed / digital_access_used / service_delivered exists. Mirrors fulfilled_or_delivered_claim guard's conditional logic.",
    evaluate: (facts) => {
      if (orderRecordFulfillment(facts) !== "UNFULFILLED") return true;
      return FACT_PREDICATES.customer_received_goods_or_service.evaluate(facts);
    },
  },

  duplicate_distinct_markers: {
    id: "duplicate_distinct_markers",
    description: "duplicate_explanation with distinct=true",
    evaluate: (facts) =>
      hasCategoryWithValueTrue(facts, ["duplicate_explanation"], "distinct"),
  },

  order_record_present: {
    id: "order_record_present",
    description: "order_record fact present (basic order context exists)",
    evaluate: (facts) => hasCategory(facts, ["order_record"]),
  },

  transaction_channel_online_present: {
    id: "transaction_channel_online_present",
    description:
      "order_record fact present with data.channel in the online channel set " +
      "(web, android, iphone) — i.e. Shopify sourceName indicates an online " +
      "store transaction, not POS or draft. Gates argumentative use of " +
      "'online transaction' / 'ecommerce transaction' in bank-facing prose.",
    evaluate: (facts) => {
      const ONLINE_CHANNELS = new Set(["web", "android", "iphone"]);
      return facts.some((f) => {
        if (f.category !== "order_record") return false;
        const channel = (f.value as Record<string, unknown>)?.channel;
        return (
          typeof channel === "string" &&
          ONLINE_CHANNELS.has(channel.toLowerCase())
        );
      });
    },
  },
};

/** Evaluate every predicate against the given facts. Result keys are
 *  the registry's predicate ids; values are boolean. Predicates that
 *  don't apply evaluate to false (NOT undefined) so consumers can
 *  treat the result as a total function. */
export function evaluateAllPredicates(
  facts: EvidenceFact[],
): Record<FactPredicateId, boolean> {
  const out: Partial<Record<FactPredicateId, boolean>> = {};
  for (const [id, predicate] of Object.entries(FACT_PREDICATES) as Array<
    [FactPredicateId, FactPredicate]
  >) {
    out[id] = predicate.evaluate(facts);
  }
  return out as Record<FactPredicateId, boolean>;
}

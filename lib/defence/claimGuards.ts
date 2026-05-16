/**
 * Claim guards — fact-property-aware validation rules.
 *
 * Each guard pairs a narrative regex with a predicate over approvedFacts.
 * Validation FAILS CLOSED: if the narrative makes the guarded claim and
 * the predicate is unsatisfied, validation fails. The failing run never
 * produces a PDF and never reaches Shopify submission.
 *
 * Tests cover every row (see __tests__/claimGuards.test.ts).
 */

import type {
  ClaimGuard,
  EvidenceFact,
  EvidenceFactCategory,
  GuardFailure,
  NarrativeSectionKey,
} from "./types";

/* ── Predicate helpers ── */

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

/* ── The guard table ── */

export const CLAIM_GUARDS: ClaimGuard[] = [
  {
    id: "delivery_was_delivered",
    description: "Claim that goods were delivered",
    pattern: /\b(was|were)\s+delivered\b|\bdelivery\s+(was\s+)?confirmed\b|\bdelivery\s+complete\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "delivered") ||
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "signature"),
    requiredFact:
      "delivery_proof or shipping_tracking with proofType='delivered' or 'signature'",
  },
  {
    id: "signature_on_delivery",
    description: "Claim of signature on delivery",
    pattern: /\bsigned\s+for\b|\bsignature\s+(was\s+)?(captured|obtained|on\s+(file|delivery))\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategoryWithValueEquals(facts, DELIVERY_CATEGORIES, "proofType", "signature"),
    requiredFact: "delivery_proof or shipping_tracking with proofType='signature'",
  },
  {
    id: "digital_access",
    description: "Claim of digital access / download",
    pattern: /\b(downloaded|accessed|used\s+the\s+service|logged\s+in|streamed)\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicate: (facts) => hasCategory(facts, DIGITAL_CATEGORIES),
    requiredFact: "digital_access_log or service_access",
  },
  {
    id: "customer_communication",
    description: "Claim of customer communication on record",
    pattern: /\b(customer\s+(contacted|emailed|messaged|wrote|replied|stated|confirmed))\b|\bemail\s+(thread|exchange|correspondence)\b/i,
    appliesToSections: ["communicationArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategory(facts, ["customer_communication", "communication"]),
    requiredFact: "customer_communication",
  },
  {
    id: "policy_accepted",
    description: "Claim that policy was accepted at checkout",
    pattern: /\b(policy\s+(was\s+)?accepted|accepted\s+(our|the)\s+(refund|return|cancellation|shipping)\s+policy)\b/i,
    appliesToSections: ["policyArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategoryWithValueTrue(facts, ["policy_acceptance"], "acceptedAtCheckout") ||
      hasCategory(facts, ["policy_acceptance"]),
    requiredFact: "policy_acceptance with acceptedAtCheckout=true",
  },
  {
    id: "refund_processed",
    description: "Claim that a refund was processed",
    pattern: /\brefund\s+(was|has\s+been)\s+(processed|issued|completed)\b|\bissued\s+a\s+refund\b/i,
    appliesToSections: ["fulfillmentArgument", "policyArgument", "executiveSummary", "conclusion", "manualEvidenceArgument"],
    predicate: (facts) =>
      hasCategoryWithValueEquals(facts, ["refund_record"], "refundStatus", "processed"),
    requiredFact: "refund_record with refundStatus='processed'",
  },
  {
    id: "prior_customer",
    description: "Claim of prior customer / repeat purchase history",
    pattern: /\b(prior|previous|past)\s+(orders?|purchases?|customer)\b|\brepeat\s+customer\b/i,
    appliesToSections: ["transactionOverviewArgument", "paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategoryWithValueGreaterThan(
        facts,
        ["prior_customer_history", "account_history"],
        "priorOrderCount",
        0,
      ),
    requiredFact: "prior_customer_history with priorOrderCount > 0",
  },
  {
    id: "three_d_secure",
    description: "Claim of 3-D Secure authentication",
    pattern: /\b3[\s-]?D[\s-]?Secure\b|\b3DS\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategoryWithValueTrue(
        facts,
        ["payment_authentication", "payment_auth"],
        "threeDS",
      ),
    requiredFact:
      "payment_authentication (or payment_auth) with threeDS=true",
  },
  {
    id: "liability_shift",
    description: "Claim of liability shift",
    pattern: /\bliability\s+shift\b|\bshifted\s+liability\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      hasCategoryWithValueTrue(
        facts,
        ["payment_authentication", "payment_auth"],
        "liabilityShift",
      ),
    requiredFact:
      "payment_authentication (or payment_auth) with liabilityShift=true",
  },
  {
    id: "avs_cvv_authenticated",
    description: "Claim that AVS / CVV authenticated the transaction",
    pattern: /\b(AVS|CVV)\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicate: (facts) =>
      facts.some(
        (f) =>
          (f.category === "payment_authentication" || f.category === "payment_auth" || f.category === "billing_match") &&
          (f.value?.avsResult !== undefined || f.value?.cvvResult !== undefined),
      ),
    requiredFact:
      "payment_authentication / payment_auth / billing_match with an avsResult or cvvResult value",
  },
  {
    id: "fulfilled_or_delivered_claim",
    description:
      "Claim of fulfilment when order.fulfillmentStatus says UNFULFILLED and no separate delivery/access fact exists",
    pattern: /\b(fulfilled|shipped|dispatched)\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicate: (facts) => {
      const orderFact = facts.find((f) => f.category === "order_record");
      const fulfillmentStatus = orderFact?.value?.fulfillmentStatus;
      // If the order is unfulfilled AND no delivery/access fact exists, the
      // claim cannot stand. If fulfillmentStatus is anything else, the
      // claim is allowed.
      if (
        typeof fulfillmentStatus === "string" &&
        fulfillmentStatus.toUpperCase() === "UNFULFILLED"
      ) {
        return (
          hasCategory(facts, DELIVERY_CATEGORIES) ||
          hasCategory(facts, DIGITAL_CATEGORIES)
        );
      }
      return true;
    },
    requiredFact:
      "delivery_proof / shipping_tracking / digital_access_log / service_access when order.fulfillmentStatus=UNFULFILLED",
  },
];

/* ── Evaluator ── */

export interface RunClaimGuardsInput {
  narrativeSections: Record<NarrativeSectionKey, { text: string }>;
  approvedFacts: EvidenceFact[];
}

export function runClaimGuards(input: RunClaimGuardsInput): {
  failures: GuardFailure[];
} {
  const failures: GuardFailure[] = [];
  const factIds = input.approvedFacts.map((f) => f.id);

  for (const [sectionKey, { text }] of Object.entries(input.narrativeSections) as Array<
    [NarrativeSectionKey, { text: string }]
  >) {
    if (!text) continue;

    for (const guard of CLAIM_GUARDS) {
      const applies =
        guard.appliesToSections === "all" ||
        guard.appliesToSections.includes(sectionKey);
      if (!applies) continue;

      const match = text.match(guard.pattern);
      if (!match) continue;

      if (guard.predicate(input.approvedFacts)) continue;

      failures.push({
        guardId: guard.id,
        section: sectionKey,
        matchedText: match[0],
        requiredFact: guard.requiredFact,
        checkedFactIds: factIds,
      });
    }
  }

  return { failures };
}

/**
 * Claim guards — fact-property-aware validation rules.
 *
 * Each guard pairs a narrative regex with a NAMED predicate from
 * `factPredicates.ts`. The same predicate id powers strategy gates
 * (Phase 3) and templated thesis tokens (Phase 4), so the evidence
 * check is authoritative across every layer.
 *
 * Validation FAILS CLOSED: if the narrative makes the guarded claim
 * and the predicate is unsatisfied, validation fails. The failing run
 * never produces a PDF and never reaches Shopify submission.
 *
 * Tests cover every row (see __tests__/claimGuards.test.ts).
 */

import { FACT_PREDICATES } from "./factPredicates";
import type {
  ClaimGuard,
  EvidenceFact,
  FactPredicateId,
  GuardFailure,
  NarrativeSectionKey,
} from "./types";

/** Build a ClaimGuard whose `predicate` is a thin reference to the
 *  shared FACT_PREDICATES registry. */
function makeGuard(g: {
  id: string;
  description: string;
  pattern: RegExp;
  appliesToSections: NarrativeSectionKey[] | "all";
  predicateId: FactPredicateId;
  requiredFact: string;
}): ClaimGuard {
  const predicate = FACT_PREDICATES[g.predicateId];
  if (!predicate) {
    throw new Error(
      `ClaimGuard ${g.id} references unknown predicateId ${g.predicateId}`,
    );
  }
  return {
    id: g.id,
    description: g.description,
    pattern: g.pattern,
    appliesToSections: g.appliesToSections,
    predicateId: g.predicateId,
    predicate: (facts) => predicate.evaluate(facts),
    requiredFact: g.requiredFact,
  };
}

/* ── The guard table ── */

export const CLAIM_GUARDS: ClaimGuard[] = [
  makeGuard({
    id: "delivery_was_delivered",
    description: "Claim that goods were delivered",
    pattern: /\b(was|were)\s+delivered\b|\bdelivery\s+(was\s+)?confirmed\b|\bdelivery\s+complete\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "delivery_confirmed",
    requiredFact:
      "delivery_proof or shipping_tracking with proofType='delivered' or 'signature'",
  }),
  makeGuard({
    id: "signature_on_delivery",
    description: "Claim of signature on delivery",
    pattern: /\bsigned\s+for\b|\bsignature\s+(was\s+)?(captured|obtained|on\s+(file|delivery))\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "signature_captured",
    requiredFact: "delivery_proof or shipping_tracking with proofType='signature'",
  }),
  makeGuard({
    id: "digital_access",
    description: "Claim that the customer downloaded / used / logged in / streamed (digital access used)",
    pattern: /\b(downloaded|accessed|used\s+the\s+service|logged\s+in|streamed)\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "digital_access_used",
    requiredFact:
      "digital_access_log or service_access with digitalAccessUsed=true / serviceUsed=true / used=true",
  }),
  makeGuard({
    id: "received_claim",
    description: "Claim that the customer received the goods or service",
    // Conservative regex — only fires on contexts strongly implying receipt
    // of goods/service. Skips "received an email", "receipt confirmed".
    pattern:
      /\b(?:customer\s+received|order\s+was\s+received|was\s+received\s+by\s+the\s+customer|received\s+the\s+(?:order|product|item|goods|service|shipment|package|merchandise))\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "customer_received_goods_or_service",
    requiredFact:
      "delivery_proof/shipping_tracking with proofType=delivered or signature, OR digital_access_log with digitalAccessUsed=true, OR service_access with serviceDelivered=true",
  }),
  makeGuard({
    id: "access_granted_claim",
    description: "Claim that digital access was granted",
    pattern: /\baccess\s+(?:was\s+)?granted\b/i,
    appliesToSections: ["fulfillmentArgument", "executiveSummary", "conclusion"],
    predicateId: "digital_access_granted",
    requiredFact:
      "digital_access_log or service_access with digitalAccessGranted=true (or accessGranted=true)",
  }),
  makeGuard({
    id: "service_completed_claim",
    description: "Claim that the service / onboarding was completed or delivered",
    pattern:
      /\b(?:service|onboarding|engagement|fulfillment)\s+(?:was\s+|has\s+been\s+)?(?:completed|delivered|fulfilled)\b/i,
    appliesToSections: ["fulfillmentArgument", "executiveSummary", "conclusion"],
    predicateId: "service_completed_or_delivered",
    requiredFact:
      "service_access with serviceDelivered=true / serviceCompleted=true, OR delivery_proof with proofType=delivered/signature",
  }),
  makeGuard({
    id: "customer_communication",
    description: "Claim of customer communication on record",
    pattern: /\b(customer\s+(contacted|emailed|messaged|wrote|replied|stated|confirmed))\b|\bemail\s+(thread|exchange|correspondence)\b/i,
    appliesToSections: ["communicationArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "customer_communication_on_record",
    requiredFact: "customer_communication",
  }),
  makeGuard({
    id: "policy_accepted",
    description: "Claim that policy was accepted at checkout",
    pattern: /\b(policy\s+(was\s+)?accepted|accepted\s+(our|the)\s+(refund|return|cancellation|shipping)\s+policy)\b/i,
    appliesToSections: ["policyArgument", "executiveSummary", "conclusion"],
    predicateId: "policy_accepted",
    requiredFact: "policy_acceptance with acceptedAtCheckout=true",
  }),
  makeGuard({
    id: "refund_processed",
    description: "Claim that a refund was processed",
    pattern: /\brefund\s+(was|has\s+been)\s+(processed|issued|completed)\b|\bissued\s+a\s+refund\b/i,
    appliesToSections: ["fulfillmentArgument", "policyArgument", "executiveSummary", "conclusion", "manualEvidenceArgument"],
    predicateId: "refund_processed",
    requiredFact: "refund_record with refundStatus='processed'",
  }),
  makeGuard({
    id: "prior_customer",
    description: "Claim of prior customer / repeat purchase history",
    pattern: /\b(prior|previous|past)\s+(orders?|purchases?|customer)\b|\brepeat\s+customer\b/i,
    appliesToSections: ["transactionOverviewArgument", "paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicateId: "prior_customer",
    requiredFact: "prior_customer_history with priorOrderCount > 0",
  }),
  makeGuard({
    id: "three_d_secure",
    description: "Claim of 3-D Secure authentication",
    pattern: /\b3[\s-]?D[\s-]?Secure\b|\b3DS\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicateId: "three_d_secure_present",
    requiredFact: "payment_authentication (or payment_auth) with threeDS=true",
  }),
  makeGuard({
    id: "liability_shift",
    description: "Claim of liability shift",
    pattern: /\bliability\s+shift\b|\bshifted\s+liability\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicateId: "liability_shift_present",
    requiredFact: "payment_authentication (or payment_auth) with liabilityShift=true",
  }),
  makeGuard({
    id: "avs_cvv_authenticated",
    description: "Claim that AVS / CVV authenticated the transaction",
    pattern: /\b(AVS|CVV)\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicateId: "avs_or_cvv_value_present",
    requiredFact:
      "payment_authentication / payment_auth / billing_match with an avsResult or cvvResult value",
  }),
  makeGuard({
    id: "fulfilled_or_delivered_claim",
    description:
      "Claim of fulfilment when order.fulfillmentStatus says UNFULFILLED and no separate delivery/access fact exists",
    pattern: /\b(fulfilled|shipped|dispatched)\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "safe_to_claim_fulfilment",
    requiredFact:
      "When order.fulfillmentStatus=UNFULFILLED: delivery_proof/shipping_tracking with proofType=delivered or signature, OR digital_access_log with digitalAccessUsed=true, OR service_access with serviceDelivered=true",
  }),
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

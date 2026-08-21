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
  ClaimPolarity,
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
  /** Omit for the ordinary case. See `ClaimPolarity`. */
  polarity?: ClaimPolarity;
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
    polarity: g.polarity ?? "affirmative",
  };
}

/**
 * "The goods came back to us" — the phrase the one negative-polarity
 * guard watches for. Built from parts because the alternation is doing
 * real work and a single opaque literal would not survive review.
 *
 * It must match a claim about WHERE THE GOODS PHYSICALLY ARE, and must
 * NOT match the two adjacent statements that are true and sanctioned:
 *   - "no refund was issued"          → no return verb at all
 *   - "no return was initiated / requested by the customer"
 *                                     → "return", never "returned"
 * Hence every branch requires a past-tense return verb, and pairs it with
 * a goods noun or a to-the-merchant destination inside the same clause
 * (`[^.!?;:\n]` never crosses a clause boundary, matching the negation
 * window's own notion of a clause).
 */
const GOODS_NOUN = "goods|items?|products?|merchandise|parcel|package|shipment|order";
/** Both the inflected and the bare form — "never returned" and "did not
 *  return" are the same claim. */
const CAME_BACK_VERB =
  "returned?|sen[dt]\\s+back|c[oa]me\\s+back|coming\\s+back|ship(?:ped)?\\s+back";
const BACK_TO_US = "to\\s+(?:the\\s+)?(?:merchant|sender|us)";
/** Stay inside ONE clause. The excluded set matches
 *  `CLAUSE_BOUNDARY_CHARS` below — the negation window's own notion of a
 *  clause — so the guard and the window never disagree about scope. */
const NEAR = "[^.!?;:,\\n()]{0,40}";
/**
 * Every branch is ANCHORED ON THE VERB, never on the noun. That is not
 * stylistic: `isNegatedContext` looks at the few words BEFORE the match,
 * so a pattern that matches at "goods" in "the goods were never
 * returned" never sees the "never" and the guard silently does nothing.
 * Anchor on "returned" and the cue is right there. (Both paraphrases in
 * the tests failed exactly this way on the first cut.)
 */
const GOODS_CAME_BACK = new RegExp(
  [
    // "never returned the goods" · "was never returned to the merchant"
    // "did not come back to us" · "were not sent back to the merchant"
    `\\b(?:${CAME_BACK_VERB})\\b${NEAR}\\b(?:${GOODS_NOUN}|${BACK_TO_US})\\b`,
    // "we never received the merchandise back"
    `\\breceived\\b${NEAR}\\bback\\b`,
  ].join("|"),
  "i",
);

/* ── The guard table ── */

export const CLAIM_GUARDS: ClaimGuard[] = [
  makeGuard({
    id: "delivery_was_delivered",
    description: "Claim that goods were delivered",
    pattern: /\b(was|were)\s+delivered\b|\bdelivery\s+(was\s+)?confirmed\b|\bdelivery\s+complete\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "delivery_confirmed",
    requiredFact:
      "delivery_proof or shipping_tracking with proofType='delivered_confirmed' or 'signature_confirmed'",
  }),
  makeGuard({
    id: "signature_on_delivery",
    description: "Claim of signature on delivery",
    pattern: /\bsigned\s+for\b|\bsignature\s+(was\s+)?(captured|obtained|on\s+(file|delivery))\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "signature_captured",
    requiredFact:
      "delivery_proof or shipping_tracking with proofType='signature_confirmed'",
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
      "delivery_proof/shipping_tracking with proofType=delivered_confirmed or signature_confirmed, OR digital_access_log with digitalAccessUsed=true, OR service_access with serviceDelivered=true",
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
      "service_access with serviceDelivered=true / serviceCompleted=true, OR delivery_proof with proofType=delivered_confirmed/signature_confirmed",
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
  // PR-C2 (C-12): ONE guard on the words "AVS|CVV", satisfied by the mere
  // presence of either code, became two guards — one per fact, each requiring
  // its own MATCH. The old rule let a CVV-only case (or an outright AVS=N)
  // license "AVS confirmed the billing address". Decision 1: a security-code
  // match can never ground an address claim.
  makeGuard({
    id: "avs_address_verified_claim",
    description: "Claim that the address was verified / AVS-matched",
    // The word AVS, or address-verification prose that avoids it.
    pattern:
      /\bAVS\b|\b(?:billing\s+)?address\s+(?:was\s+|has\s+been\s+)?(?:verified|match\w*|confirm\w*)\b|\bmatch\w*\s+the\s+issuer'?s?\s+(?:address\s+)?records?\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicateId: "avs_address_verified",
    requiredFact:
      "payment_authentication / payment_auth whose AVS result is a match (a CVV match does not satisfy this)",
  }),
  makeGuard({
    id: "cvv_verified_claim",
    description: "Claim that the card security code was verified",
    pattern: /\bCVV\b|\bCVC\b|\bcard\s+(?:security|verification)\s+(?:code|value)\b/i,
    appliesToSections: ["paymentAuthenticationArgument", "executiveSummary", "conclusion"],
    predicateId: "cvv_verified",
    requiredFact: "payment_authentication / payment_auth whose CVV result is a match",
  }),
  /* ── The one NEGATIVE-polarity guard ──────────────────────────────
   *
   * Every rule above polices an assertion. This one polices a DENIAL,
   * because on a returned parcel the denial is the false statement.
   *
   * cay-collective #13195 shipped a validated draft whose executive
   * summary read "no refund obligation arose, as the goods were never
   * returned to the merchant" — while DHL had the parcel back with the
   * merchant since 2026-07-06. Nothing could catch it: the affirmative
   * machinery skips negated clauses by design, and #586/#587 had just
   * hardened that skip (correctly — "no refund was issued" is not a
   * refund claim). The gap was never the negation window; it was that
   * no guard ever asked whether a denial was TRUE. */
  makeGuard({
    id: "goods_never_returned_claim",
    description:
      "Denial that the goods came back to the merchant, on an order whose parcel was returned to sender",
    polarity: "negative",
    // Deliberately narrow: it must catch the RETURN-OF-GOODS denial and
    // nothing adjacent. "no refund was issued" and "no return was
    // requested by the customer" are both true and both sanctioned; only
    // a claim about where the goods physically are is guarded.
    pattern: GOODS_CAME_BACK,
    appliesToSections: [
      "fulfillmentArgument",
      "chronologyArgument",
      "executiveSummary",
      "conclusion",
    ],
    predicateId: "safe_to_deny_return",
    requiredFact:
      "no delivery_proof / shipping_tracking fact with proofType='returned_to_sender' (a carrier return-to-sender makes any denial that the goods came back false)",
  }),
  makeGuard({
    id: "fulfilled_or_delivered_claim",
    description:
      "Claim of fulfilment when order.fulfillmentStatus says UNFULFILLED and no separate delivery/access fact exists",
    pattern: /\b(fulfilled|shipped|dispatched)\b/i,
    appliesToSections: ["fulfillmentArgument", "chronologyArgument", "executiveSummary", "conclusion"],
    predicateId: "safe_to_claim_fulfilment",
    requiredFact:
      "When order.fulfillmentStatus=UNFULFILLED: delivery_proof/shipping_tracking with proofType=delivered_confirmed or signature_confirmed, OR digital_access_log with digitalAccessUsed=true, OR service_access with serviceDelivered=true",
  }),
];

/* ── Negation window ── */

/**
 * A guard polices an AFFIRMATIVE claim; the same words inside a negated
 * clause assert the opposite. "no refund was issued" is not a refund
 * claim — it is the sanctioned no-return framing that
 * `credit_not_processed_no_return` explicitly instructs (cay-collective
 * #13195, 2026-08-18: prompt 16 mandated that exact sentence and
 * validator 3 rejected it, deterministically, retry included).
 *
 * A match is negated when a negation cue appears among the last
 * NEGATION_WINDOW_TOKENS words of the SAME clause before the match.
 * Clause boundaries (.,;:!? and newlines) reset the window, so a
 * negation in one clause never licenses an affirmative claim in the
 * next ("no return was initiated, and a refund was issued" still
 * fires). Scanning continues past a negated match — a later
 * affirmative occurrence in the same section still fires the guard.
 */
const NEGATION_WINDOW_TOKENS = 4;
const CLAUSE_BOUNDARY_CHARS = /[.!?;:,\n()]/;
const NEGATION_CUE = /^(?:no|not|never|without|nor|neither|cannot)$|n['’]t$/i;

export function isNegatedContext(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);
  let clauseStart = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (CLAUSE_BOUNDARY_CHARS.test(before[i])) {
      clauseStart = i + 1;
      break;
    }
  }
  const tokens = before
    .slice(clauseStart)
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}'’]+|[^\p{L}'’]+$/gu, ""))
    .filter(Boolean);
  return tokens
    .slice(-NEGATION_WINDOW_TOKENS)
    .some((t) => NEGATION_CUE.test(t));
}

/** First match of `pattern` in `text` that is NOT inside a negated clause. */
function firstAffirmativeMatch(
  text: string,
  pattern: RegExp,
): RegExpExecArray | null {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : pattern.flags + "g";
  for (const m of text.matchAll(new RegExp(pattern.source, flags))) {
    if (!isNegatedContext(text, m.index ?? 0)) return m as RegExpExecArray;
  }
  return null;
}

/** First match of `pattern` in `text` that IS inside a negated clause —
 *  the mirror of `firstAffirmativeMatch`, for `negative`-polarity guards.
 *  Reuses `isNegatedContext` unchanged so the two polarities can never
 *  disagree about what counts as negated. */
function firstNegatedMatch(
  text: string,
  pattern: RegExp,
): RegExpExecArray | null {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : pattern.flags + "g";
  for (const m of text.matchAll(new RegExp(pattern.source, flags))) {
    if (isNegatedContext(text, m.index ?? 0)) return m as RegExpExecArray;
  }
  return null;
}

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

      const match =
        guard.polarity === "negative"
          ? firstNegatedMatch(text, guard.pattern)
          : firstAffirmativeMatch(text, guard.pattern);
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

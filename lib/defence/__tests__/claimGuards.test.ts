import { describe, it, expect } from "vitest";
import { runClaimGuards, CLAIM_GUARDS, isNegatedContext } from "../claimGuards";
import { FACT_PREDICATES } from "../factPredicates";
import type {
  EvidenceFact,
  NarrativeSectionKey,
} from "../types";

function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value: {},
    source: "shopify_order",
    sourceRef: null,
    strength: "strong",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    ...overrides,
  };
}

type NarrativeMap = Record<NarrativeSectionKey, { text: string }>;

function narrative(partial: Partial<NarrativeMap>): NarrativeMap {
  const empty: NarrativeMap = {
    executiveSummary: { text: "" },
    transactionOverviewArgument: { text: "" },
    chronologyArgument: { text: "" },
    paymentAuthenticationArgument: { text: "" },
    fulfillmentArgument: { text: "" },
    communicationArgument: { text: "" },
    policyArgument: { text: "" },
    manualEvidenceArgument: { text: "" },
    conclusion: { text: "" },
  };
  return { ...empty, ...partial } as NarrativeMap;
}

describe("claimGuards (Phase 2 predicate wiring)", () => {
  it("every CLAIM_GUARD references a known predicateId", () => {
    for (const guard of CLAIM_GUARDS) {
      expect(guard.predicateId).toBeDefined();
      expect(FACT_PREDICATES[guard.predicateId]).toBeDefined();
    }
  });

  it("guard predicate output matches FACT_PREDICATES[predicateId].evaluate", () => {
    // Build a fact set with all the bits guards care about so different
    // guards take different paths.
    const facts: EvidenceFact[] = [
      {
        id: "f0",
        category: "payment_authentication",
        label: "auth",
        value: { avsResult: "Y", cvvResult: "M", threeDS: true, liabilityShift: true },
        source: "shopify_order",
        sourceRef: null,
        strength: "strong",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ];
    for (const guard of CLAIM_GUARDS) {
      const guardResult = guard.predicate(facts);
      const predicateResult = FACT_PREDICATES[guard.predicateId].evaluate(facts);
      expect(guardResult, `guard ${guard.id}`).toBe(predicateResult);
    }
  });
});

describe("claimGuards", () => {
  it("unsupported delivery claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The order was delivered to the customer." } }),
      approvedFacts: [],
    });
    expect(result.failures.some((f) => f.guardId === "delivery_was_delivered")).toBe(true);
  });

  it("delivery claim passes when proofType=delivered_confirmed is present (collector vocabulary)", () => {
    // Regression for dispute 328a45e4 (2026-07): the fulfillment
    // collector writes proofType='delivered_confirmed', but the guard
    // only accepted the bare 'delivered', so a narrative saying the
    // goods "were delivered" failed validation even with carrier-
    // confirmed delivery on the fact.
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The goods were delivered to the customer." } }),
      approvedFacts: [
        fact({
          category: "delivery_proof",
          value: {
            proofType: "delivered_confirmed",
            carrier: "PostNord SE",
            deliveredAt: "2026-05-12T17:27:00Z",
            deliveredToVerifiedAddress: true,
          },
        }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "delivery_was_delivered")).toBe(false);
  });

  it("delivery claim passes when legacy proofType=delivered is present", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The order was delivered to the customer." } }),
      approvedFacts: [
        fact({ category: "delivery_proof", value: { proofType: "delivered" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "delivery_was_delivered")).toBe(false);
  });

  it("delivery claim still fails on proofType=delivered_unverified", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The order was delivered to the customer." } }),
      approvedFacts: [
        fact({ category: "delivery_proof", value: { proofType: "delivered_unverified" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "delivery_was_delivered")).toBe(true);
  });

  it("signature claim passes when proofType=signature_confirmed is present (collector vocabulary)", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer signed for the package." } }),
      approvedFacts: [
        fact({ category: "delivery_proof", value: { proofType: "signature_confirmed" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "signature_on_delivery")).toBe(false);
  });

  it("unsupported signature claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer signed for the package." } }),
      approvedFacts: [
        // Has delivery proof but not signature.
        fact({ category: "delivery_proof", value: { proofType: "delivered_confirmed" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "signature_on_delivery")).toBe(true);
  });

  it("unsupported digital access claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer accessed the digital download." } }),
      approvedFacts: [fact()],
    });
    expect(result.failures.some((f) => f.guardId === "digital_access")).toBe(true);
  });

  it("unsupported customer-communication claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ communicationArgument: { text: "The customer emailed us about the order." } }),
      approvedFacts: [fact()],
    });
    expect(result.failures.some((f) => f.guardId === "customer_communication")).toBe(true);
  });

  it("unsupported policy-acceptance claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ policyArgument: { text: "The customer accepted our refund policy at checkout." } }),
      approvedFacts: [fact()],
    });
    expect(result.failures.some((f) => f.guardId === "policy_accepted")).toBe(true);
  });

  it("unsupported refund-processed claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ conclusion: { text: "A refund has been processed for this charge." } }),
      approvedFacts: [fact()],
    });
    expect(result.failures.some((f) => f.guardId === "refund_processed")).toBe(true);
  });

  it("unsupported prior-customer claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ transactionOverviewArgument: { text: "The cardholder is a repeat customer." } }),
      approvedFacts: [fact()],
    });
    expect(result.failures.some((f) => f.guardId === "prior_customer")).toBe(true);
  });

  it("prior-customer claim passes when priorOrderCount > 0", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ transactionOverviewArgument: { text: "The cardholder is a repeat customer." } }),
      approvedFacts: [
        fact({ category: "prior_customer_history", value: { priorOrderCount: 3 } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "prior_customer")).toBe(false);
  });

  it("unsupported 3DS claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "The transaction was 3-D Secure authenticated." } }),
      approvedFacts: [
        fact({ category: "payment_authentication", value: { avsResult: "Y" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "three_d_secure")).toBe(true);
  });

  it("3DS claim passes when threeDS=true is present", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "The transaction was 3-D Secure authenticated." } }),
      approvedFacts: [
        fact({ category: "payment_authentication", value: { threeDS: true } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "three_d_secure")).toBe(false);
  });

  it("unsupported liability-shift claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "Liability shift applies to this transaction." } }),
      approvedFacts: [fact()],
    });
    expect(result.failures.some((f) => f.guardId === "liability_shift")).toBe(true);
  });

  it("unsupported AVS mention fails when no result is present", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: {} })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(true);
  });

  // PR-C2 (C-12): the guard now requires a MATCH, not a value. The old
  // predicate passed on AVS=N, licensing "AVS confirmed the address" on a
  // transaction the issuer had refused to verify.
  it("AVS mention fails when the AVS result is present but did not match", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: { avsResult: "N" } })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(true);
  });

  it("AVS mention fails on a CVV-only match — a security code is not an address", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: { avsResult: "N", cvvResult: "M" } })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(true);
  });

  it("AVS mention passes on a primary-sourced (network, code) cell", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: { avsResult: "Y", network: "visa" } })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(false);
  });

  // PR-C3: the same letter on a network whose AVS table we have never read
  // authorizes nothing. Register R-E is a Visa document.
  it("AVS mention FAILS on a Mastercard Y — no sourced cell", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: { avsResult: "Y", network: "mastercard" } })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(true);
  });

  it("AVS mention FAILS on a historical fact with no network — fails closed", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: { avsResult: "Y" } })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(true);
  });

  it("fulfilled claim fails on UNFULFILLED order with no separate delivery fact", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The order was shipped to the customer." } }),
      approvedFacts: [
        fact({
          category: "order_record",
          value: { fulfillmentStatus: "UNFULFILLED" },
        }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "fulfilled_or_delivered_claim")).toBe(true);
  });

  it("fulfilled claim passes on UNFULFILLED order when digital_access_log with digitalAccessUsed=true exists", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer streamed the content." } }),
      approvedFacts: [
        fact({ category: "order_record", value: { fulfillmentStatus: "UNFULFILLED" } }),
        fact({ id: "f1", category: "digital_access_log", value: { digitalAccessUsed: true } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "fulfilled_or_delivered_claim")).toBe(false);
  });

  it("fulfilled claim FAILS on UNFULFILLED order when digital_access_log lacks digitalAccessUsed", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The product was shipped." } }),
      approvedFacts: [
        fact({ category: "order_record", value: { fulfillmentStatus: "UNFULFILLED" } }),
        fact({ id: "f1", category: "digital_access_log", value: {} }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "fulfilled_or_delivered_claim")).toBe(true);
  });

  it("FULFILLED status alone does NOT allow 'received'", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer received the order." } }),
      approvedFacts: [
        fact({ category: "order_record", value: { fulfillmentStatus: "FULFILLED" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "received_claim")).toBe(true);
  });

  it("'received the order' passes when delivery_proof with proofType=delivered exists", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer received the order." } }),
      approvedFacts: [
        fact({ category: "delivery_proof", value: { proofType: "delivered" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "received_claim")).toBe(false);
  });

  it("'access granted' fails without digitalAccessGranted=true", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "Access was granted to the customer." } }),
      approvedFacts: [
        fact({ category: "digital_access_log", value: {} }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "access_granted_claim")).toBe(true);
  });

  it("'access granted' passes when digitalAccessGranted=true", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "Access was granted to the customer." } }),
      approvedFacts: [
        fact({ category: "digital_access_log", value: { digitalAccessGranted: true } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "access_granted_claim")).toBe(false);
  });

  it("'accessed' / 'used' requires digitalAccessUsed=true", () => {
    const failsResult = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer accessed the platform." } }),
      approvedFacts: [
        fact({ category: "digital_access_log", value: { digitalAccessGranted: true } }),
      ],
    });
    expect(failsResult.failures.some((f) => f.guardId === "digital_access")).toBe(true);

    const passesResult = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer accessed the platform." } }),
      approvedFacts: [
        fact({ category: "digital_access_log", value: { digitalAccessUsed: true } }),
      ],
    });
    expect(passesResult.failures.some((f) => f.guardId === "digital_access")).toBe(false);
  });

  it("'service was completed' fails without serviceDelivered=true", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The service was completed by the merchant." } }),
      approvedFacts: [
        fact({ category: "service_access", value: {} }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "service_completed_claim")).toBe(true);
  });

  it("'service was completed' passes when service_access with serviceDelivered=true exists", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The service was completed by the merchant." } }),
      approvedFacts: [
        fact({ category: "service_access", value: { serviceDelivered: true } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "service_completed_claim")).toBe(false);
  });
});

describe("claimGuards — negated statements are not claims (validator 4)", () => {
  // Verbatim conclusion from cay-collective #13195 (prod, 2026-08-18):
  // the credit_not_processed_no_return strategy INSTRUCTS this sentence,
  // and validator 3 failed it as an affirmative refund claim.
  const CAY_13195_CONCLUSION =
    "The available records indicate that no return was initiated by the " +
    "customer, and no refund was issued. The submitted evidence is " +
    "consistent with a position that no refund was owed at the time of " +
    "this dispute. On this basis, the merchant respectfully requests that " +
    "the dispute be resolved in the merchant's favour.";

  it("'no refund was issued' does NOT fire refund_processed (cay-collective #13195)", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ conclusion: { text: CAY_13195_CONCLUSION } }),
      approvedFacts: [
        fact({ id: "no_return_initiated#shopify_order", category: "no_return_initiated" }),
      ],
    });
    expect(result.failures).toEqual([]);
  });

  it("an affirmative refund claim still fires with the same fact set", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ conclusion: { text: "A refund was issued to the cardholder." } }),
      approvedFacts: [
        fact({ id: "no_return_initiated#shopify_order", category: "no_return_initiated" }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "refund_processed")).toBe(true);
  });

  it("a negated match does not mask a later affirmative match in the same section", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({
        conclusion: {
          text: "No refund was issued at first. Later, a refund was issued in full.",
        },
      }),
      approvedFacts: [],
    });
    expect(result.failures.some((f) => f.guardId === "refund_processed")).toBe(true);
  });

  it("negation in one clause does not license a claim in the next clause", () => {
    // The comma bounds the negation window: "no return…" cannot make
    // ", and a refund was issued" safe.
    const result = runClaimGuards({
      narrativeSections: narrative({
        conclusion: { text: "No return was initiated, and a refund was issued." },
      }),
      approvedFacts: [],
    });
    expect(result.failures.some((f) => f.guardId === "refund_processed")).toBe(true);
  });

  it("the same defect class is closed for other guards ('no signature was captured', 'never signed for')", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({
        fulfillmentArgument: {
          text: "No signature was captured by the carrier, and the customer never signed for the parcel.",
        },
      }),
      approvedFacts: [],
    });
    expect(result.failures.some((f) => f.guardId === "signature_on_delivery")).toBe(false);
  });

  /* ── Negative-polarity guard (cay-collective #13195, 2026-08-20) ── */

  const returnedFact = (): EvidenceFact =>
    fact({
      id: "delivery-returned",
      category: "delivery_proof",
      label: "Delivery",
      value: { proofType: "returned_to_sender" },
      strength: "invalid",
    });

  it("fires on the exact sentence that shipped in the #13195 draft", () => {
    const text =
      "The available evidence is consistent with a position that no refund " +
      "obligation arose, as the goods were never returned to the merchant.";
    const result = runClaimGuards({
      narrativeSections: narrative({ executiveSummary: { text } }),
      approvedFacts: [returnedFact()],
    });
    expect(
      result.failures.some((f) => f.guardId === "goods_never_returned_claim"),
    ).toBe(true);
  });

  it("stays silent on the same sentence when no parcel came back", () => {
    const text =
      "The available evidence is consistent with a position that no refund " +
      "obligation arose, as the goods were never returned to the merchant.";
    const result = runClaimGuards({
      narrativeSections: narrative({ executiveSummary: { text } }),
      approvedFacts: [],
    });
    expect(
      result.failures.some((f) => f.guardId === "goods_never_returned_claim"),
    ).toBe(false);
  });

  it("does not fire on the sanctioned no-return / no-refund framings", () => {
    // Both are TRUE statements about the order record and both are what
    // the credit_not_processed module is instructed to say. Guarding them
    // would re-open the #586/#587 defect from the other side.
    const result = runClaimGuards({
      narrativeSections: narrative({
        conclusion: {
          text:
            "No return was initiated by the customer, and no refund was issued. " +
            "The customer did not request a return.",
        },
      }),
      approvedFacts: [returnedFact()],
    });
    expect(
      result.failures.some((f) => f.guardId === "goods_never_returned_claim"),
    ).toBe(false);
  });

  it("catches the paraphrases, not only the one sentence", () => {
    for (const text of [
      "The customer never returned the item.",
      "We never received the merchandise back.",
      "The parcel did not come back to us.",
      "The goods were not sent back to the merchant.",
    ]) {
      const result = runClaimGuards({
        narrativeSections: narrative({ conclusion: { text } }),
        approvedFacts: [returnedFact()],
      });
      expect(
        result.failures.some((f) => f.guardId === "goods_never_returned_claim"),
        `expected a failure for: ${text}`,
      ).toBe(true);
    }
  });

  it("an AFFIRMATIVE statement that the goods came back is not this guard's business", () => {
    // Stating the truth ("the parcel was returned to sender on 6 July")
    // must never be blocked — the guard polices the denial only.
    const result = runClaimGuards({
      narrativeSections: narrative({
        chronologyArgument: {
          text: "The parcel was returned to the merchant on 6 July 2026.",
        },
      }),
      approvedFacts: [returnedFact()],
    });
    expect(
      result.failures.some((f) => f.guardId === "goods_never_returned_claim"),
    ).toBe(false);
  });

  it("isNegatedContext: cue must be within the trailing window of the same clause", () => {
    const negated = "and no refund was issued";
    expect(isNegatedContext(negated, negated.indexOf("refund"))).toBe(true);

    const affirmative = "therefore a refund was issued";
    expect(isNegatedContext(affirmative, affirmative.indexOf("refund"))).toBe(false);

    const boundary = "no return was initiated, and a refund was issued";
    expect(isNegatedContext(boundary, boundary.indexOf("refund was"))).toBe(false);
  });
});

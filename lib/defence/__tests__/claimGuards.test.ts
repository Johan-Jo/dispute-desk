import { describe, it, expect } from "vitest";
import { runClaimGuards, CLAIM_GUARDS } from "../claimGuards";
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

  it("delivery claim passes when proofType=delivered is present", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The order was delivered to the customer." } }),
      approvedFacts: [
        fact({ category: "delivery_proof", value: { proofType: "delivered" } }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "delivery_was_delivered")).toBe(false);
  });

  it("unsupported signature claim fails", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer signed for the package." } }),
      approvedFacts: [
        // Has delivery proof but not signature.
        fact({ category: "delivery_proof", value: { proofType: "delivered" } }),
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

  it("unsupported AVS/CVV mention fails when no result is present", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: {} })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_cvv_authenticated")).toBe(true);
  });

  it("AVS mention passes when avsResult is on a payment_auth fact", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ paymentAuthenticationArgument: { text: "AVS confirmed the cardholder address." } }),
      approvedFacts: [fact({ value: { avsResult: "Y" } })],
    });
    expect(result.failures.some((f) => f.guardId === "avs_cvv_authenticated")).toBe(false);
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

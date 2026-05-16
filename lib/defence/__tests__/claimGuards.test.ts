import { describe, it, expect } from "vitest";
import { runClaimGuards } from "../claimGuards";
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

  it("fulfilled claim passes on UNFULFILLED order when a digital_access_log fact exists", () => {
    const result = runClaimGuards({
      narrativeSections: narrative({ fulfillmentArgument: { text: "The customer streamed the content." } }),
      approvedFacts: [
        fact({ category: "order_record", value: { fulfillmentStatus: "UNFULFILLED" } }),
        fact({ id: "f1", category: "digital_access_log", value: {} }),
      ],
    });
    expect(result.failures.some((f) => f.guardId === "fulfilled_or_delivered_claim")).toBe(false);
  });
});

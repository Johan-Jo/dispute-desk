import { describe, it, expect } from "vitest";
import { renderThesis } from "../renderThesis";
import type { EvidenceFact } from "../../types";

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

describe("renderThesis", () => {
  describe("executiveSummary / unauthorized_fraud", () => {
    it("renders with AVS+CVV when 3DS is absent", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [fact({ value: { avsResult: "Y", cvvResult: "M" } })],
      });
      expect(text).toContain("AVS and CVV match");
      expect(text).toContain("consistent with a cardholder-authorized transaction");
    });

    it("renders with 3-D Secure when threeDS=true", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [
          fact({ value: { avsResult: "Y", cvvResult: "M", threeDS: true } }),
        ],
      });
      expect(text).toContain("3-D Secure authentication");
    });

    it("includes the prior-customer optional clause when the predicate is true", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [
          fact({ value: { avsResult: "Y", cvvResult: "M" } }),
          fact({
            id: "f1",
            category: "prior_customer_history",
            value: { priorOrderCount: 5 },
          }),
        ],
      });
      expect(text).toContain("5 prior undisputed orders");
    });

    it("strips the prior-customer optional clause when the fact is missing", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [fact({ value: { avsResult: "Y", cvvResult: "M" } })],
      });
      expect(text).not.toContain("prior undisputed");
    });

    it("returns empty string when required token (paymentAuthMethod) is unresolvable", () => {
      // No payment_authentication fact at all → token returns null → template returns "".
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [
          fact({ category: "order_record", value: { fulfillmentStatus: "FULFILLED" } }),
        ],
      });
      expect(text).toBe("");
    });
  });

  describe("fallback chain", () => {
    it("uses (family, mode) when available", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "narrow",
        approvedFacts: [fact({ value: { avsResult: "Y", cvvResult: "M" } })],
      });
      // narrow-mode template uses "available records" phrasing
      expect(text).toContain("available records");
    });

    it("falls back to (family, any) when (family, mode) is absent", () => {
      // item_not_received only has a (family, "any") template
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "item_not_received",
        packageMode: "full",
        approvedFacts: [
          fact({ category: "delivery_proof", value: { proofType: "delivered" } }),
        ],
      });
      expect(text).toContain("item-not-received");
    });

    it("falls back to (any, any) for an unmatched family", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "processing_error",
        packageMode: "full",
        approvedFacts: [],
      });
      // (any, any) template references "the chargeback identified above"
      expect(text).toContain("chargeback identified above");
    });
  });

  describe("optional-clause stripping cleanup", () => {
    it("doesn't leave stray punctuation when optional clauses are stripped", () => {
      const text = renderThesis({
        sectionKey: "executiveSummary",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [fact({ value: { avsResult: "Y", cvvResult: "M" } })],
      });
      // Should not contain double periods, hanging commas, double spaces.
      expect(text).not.toMatch(/\.\s*\./);
      expect(text).not.toMatch(/,\s*\./);
      expect(text).not.toMatch(/\s\s+/);
    });
  });

  describe("required-token gate", () => {
    it("returns empty string when the matched template's required token fails", () => {
      // The (unauthorized_fraud, any) paymentAuthenticationArgument
      // template requires paymentAuthMethod. With no auth fact in the
      // approved set, the token resolves null and the template returns
      // "". renderThesis intentionally does NOT fall back to a less-
      // specific template — a more-specific template that can't render
      // is a signal that the facts aren't there, not an invitation to
      // claim something via a generic fallback.
      const text = renderThesis({
        sectionKey: "paymentAuthenticationArgument",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [], // no auth fact → required paymentAuthMethod fails
      });
      expect(text).toBe("");
    });

    it("uses (any, any) when no family-specific template exists for the section", () => {
      // transactionOverviewArgument only has (any, any). With no
      // approved facts, paymentAuthMethod is null — but it's optional
      // there, so the template still renders the required text.
      const text = renderThesis({
        sectionKey: "transactionOverviewArgument",
        familyKey: "unauthorized_fraud",
        packageMode: "full",
        approvedFacts: [],
      });
      expect(text).toContain("internally consistent with cardholder-initiated activity");
    });
  });
});

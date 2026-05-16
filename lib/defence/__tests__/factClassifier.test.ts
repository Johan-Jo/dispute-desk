import { describe, it, expect } from "vitest";
import { classifyFacts, type ClassifyFactsInput, type PackSectionLike } from "../factClassifier";
import { resolveReasonCodeModule } from "../reasonCodes/registry";

function baseInput(overrides: Partial<ClassifyFactsInput> = {}): ClassifyFactsInput {
  return {
    packageId: "pkg0",
    sections: [],
    evidenceItems: [],
    checklist: [],
    coverage: { state: "not_covered" },
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "moderate",
    manualRows: [],
    reasonCodeModule: resolveReasonCodeModule("10.4"),
    ...overrides,
  };
}

function section(overrides: Partial<PackSectionLike>): PackSectionLike {
  return {
    type: "other",
    label: "Test",
    source: "shopify_order",
    data: {},
    fieldsProvided: [],
    ...overrides,
  };
}

describe("classifyFacts", () => {
  it("Visa 10.4 with AVS/CVV match produces a bank-eligible payment_authentication fact", () => {
    const result = classifyFacts(
      baseInput({
        caseStrength: "moderate",
        sections: [
          section({
            data: { avsResultCode: "Y", cvvResultCode: "M" },
            fieldsProvided: ["avs_cvv_match"],
          }),
          section({
            data: { match: true },
            fieldsProvided: ["billing_address_match"],
          }),
        ],
      }),
    );
    expect(result.eligible).toBe(true);
    const auth = result.approved.find((f) => f.category === "payment_authentication");
    expect(auth).toBeDefined();
    expect(auth?.bankEligible).toBe(true);
    expect(auth?.strength).toBe("strong");
    expect(auth?.value.avsResult).toBe("Y");
    expect(auth?.value.cvvResult).toBe("M");
  });

  it("IP location check is classified as internal-only and submission-risk", () => {
    const result = classifyFacts(
      baseInput({
        sections: [
          section({
            data: { avsResultCode: "Y", cvvResultCode: "M" },
            fieldsProvided: ["avs_cvv_match"],
          }),
          section({
            data: { match: true },
            fieldsProvided: ["billing_address_match"],
          }),
          section({
            data: { locationMatch: "no_match" },
            fieldsProvided: ["ip_location_check"],
          }),
        ],
      }),
    );
    const ipFact = result.internalOnly.find((f) => f.category === "ip_location");
    expect(ipFact).toBeDefined();
    expect(ipFact?.submissionRisk).toBe(true);
    expect(ipFact?.bankEligible).toBe(false);
    // Must not appear in approved.
    expect(result.approved.find((f) => f.category === "ip_location")).toBeUndefined();
  });

  it("fraud_risk_screening is excluded from approved facts (internal-only)", () => {
    const result = classifyFacts(
      baseInput({
        sections: [
          section({
            data: { avsResultCode: "Y", cvvResultCode: "M" },
            fieldsProvided: ["avs_cvv_match"],
          }),
          section({
            data: { match: true },
            fieldsProvided: ["billing_address_match"],
          }),
          section({
            data: { positiveFacts: [{ name: "low_risk" }] },
            fieldsProvided: ["fraud_risk_screening"],
          }),
        ],
      }),
    );
    expect(result.approved.find((f) => f.category === "fraud_screening")).toBeUndefined();
    expect(result.internalOnly.find((f) => f.category === "fraud_screening")).toBeDefined();
  });

  it("coverage-gated input returns eligible=false with reason covered_shopify", () => {
    const result = classifyFacts(
      baseInput({
        coverage: { state: "covered_shopify" },
        sections: [
          section({ data: { avsResultCode: "Y", cvvResultCode: "M" }, fieldsProvided: ["avs_cvv_match"] }),
        ],
      }),
    );
    expect(result.eligible).toBe(false);
    expect(result.ineligibilityReason).toBe("covered_shopify");
    expect(result.approved).toHaveLength(0);
  });

  it("empty pack returns eligible=false with reason no_bank_eligible_facts", () => {
    const result = classifyFacts(baseInput({ sections: [] }));
    expect(result.eligible).toBe(false);
    expect(result.ineligibilityReason).toBe("no_bank_eligible_facts");
  });

  it("weak caseStrength with eligible facts produces packageMode=narrow", () => {
    const result = classifyFacts(
      baseInput({
        caseStrength: "weak",
        sections: [
          section({ data: { avsResultCode: "Y", cvvResultCode: "M" }, fieldsProvided: ["avs_cvv_match"] }),
          section({ data: { match: true }, fieldsProvided: ["billing_address_match"] }),
        ],
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.packageMode).toBe("narrow");
  });

  it("fatal-loss with surviving bank-eligible fact produces packageMode=narrow", () => {
    const result = classifyFacts(
      baseInput({
        caseStrength: "moderate",
        fatalLoss: { triggered: true, reason: "refund_issued" },
        sections: [
          section({ data: { avsResultCode: "Y", cvvResultCode: "M" }, fieldsProvided: ["avs_cvv_match"] }),
          section({ data: { match: true }, fieldsProvided: ["billing_address_match"] }),
        ],
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.packageMode).toBe("narrow");
  });

  it("strong case with 2+ bank-eligible categories and all critical categories present produces packageMode=full", () => {
    const result = classifyFacts(
      baseInput({
        caseStrength: "strong",
        sections: [
          section({ data: { avsResultCode: "Y", cvvResultCode: "M" }, fieldsProvided: ["avs_cvv_match"] }),
          section({ data: { match: true }, fieldsProvided: ["billing_address_match"] }),
          section({ data: { proofType: "delivered_confirmed" }, fieldsProvided: ["delivery_proof"] }),
        ],
      }),
    );
    expect(result.packageMode).toBe("full");
  });

  it("manual upload marked bank-eligible appears in approved as supporting strength", () => {
    const result = classifyFacts(
      baseInput({
        sections: [
          section({ data: { avsResultCode: "Y", cvvResultCode: "M" }, fieldsProvided: ["avs_cvv_match"] }),
          section({ data: { match: true }, fieldsProvided: ["billing_address_match"] }),
        ],
        manualRows: [
          {
            id: "m1",
            evidenceItemId: "ei1",
            filename: "receipt.pdf",
            fileType: "application/pdf",
            description: "Signed delivery acknowledgement",
            bankEligible: true,
            includeInPackage: true,
            includeInBankNarrative: true,
            evidenceCategory: "manual_evidence",
          },
        ],
      }),
    );
    const manualFact = result.approved.find((f) => f.source === "manual_upload");
    expect(manualFact).toBeDefined();
    expect(manualFact?.strength).toBe("supporting");
    expect(manualFact?.bankEligible).toBe(true);
    expect(manualFact?.includeInBankNarrative).toBe(true);
  });

  it("submission_risk=true facts never appear in approved by default", () => {
    const result = classifyFacts(
      baseInput({
        sections: [
          section({ data: { avsResultCode: "Y", cvvResultCode: "M" }, fieldsProvided: ["avs_cvv_match"] }),
          section({ data: { match: true }, fieldsProvided: ["billing_address_match"] }),
          section({ data: { locationMatch: "no_match" }, fieldsProvided: ["ip_location_check"] }),
          section({ data: { consistent: false }, fieldsProvided: ["device_session_consistency"] }),
        ],
      }),
    );
    expect(result.approved.every((f) => !f.submissionRisk)).toBe(true);
  });
});

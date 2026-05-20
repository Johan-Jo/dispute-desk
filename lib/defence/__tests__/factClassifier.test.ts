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

  it("negative IP location payload (different country) never reaches bank-facing surfaces", () => {
    // Updated 2026-05-20. ip_location_check is no longer blanket
    // internal-only — the collector's `bankEligible` flag decides.
    // For a negative payload (different country, or VPN/proxy/hosting
    // detected, or inconsistent IP history) the collector sets
    // bankEligible=false, the categorizer returns "supporting", and
    // the resulting fact has bankEligible=false + includeInBankNarrative=false
    // so it never reaches the LLM payload, the PDF Evidence Basis,
    // or the bank-facing argument.
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
            data: {
              locationMatch: "different_country",
              bankEligible: false,
              ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } },
            },
            fieldsProvided: ["ip_location_check"],
          }),
        ],
      }),
    );
    const ipFact = [...result.approved, ...result.internalOnly, ...result.submissionRisk].find(
      (f) => f.category === "ip_location",
    );
    expect(ipFact).toBeDefined();
    expect(ipFact?.bankEligible).toBe(false);
    expect(ipFact?.includeInBankNarrative).toBe(false);
  });

  it("clean IP location payload (same country + no privacy flags) is bank-eligible supporting evidence", () => {
    // 2026-05-20 — positive promotion. A clean IP match reaches the
    // approved bucket as bank-eligible supporting evidence so the
    // narrative writer can cite it as corroborating the cardholder's
    // location. Pinned to MODERATE for same_city, SUPPORTING for
    // same_country — never STRONG (IP is descriptive, not contractual).
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
            data: {
              locationMatch: "same_city",
              bankEligible: true,
              ipinfo: { privacy: { vpn: false, proxy: false, hosting: false } },
              ipConsistencyLevel: "consistent",
              riskLevel: "low",
            },
            fieldsProvided: ["ip_location_check"],
          }),
        ],
      }),
    );
    const ipFact = result.approved.find((f) => f.category === "ip_location");
    expect(ipFact).toBeDefined();
    expect(ipFact?.bankEligible).toBe(true);
    expect(ipFact?.includeInBankNarrative).toBe(true);
    expect(ipFact?.strength).toBe("moderate");
    expect(ipFact?.value.locationMatch).toBe("same_city");
  });

  it("fraud_risk_screening reaches approved facts (citable when source-gated)", () => {
    // Updated 2026-05-19. fraud_risk_screening is no longer in
    // INTERNAL_ONLY_FIELDS or SUBMISSION_RISK_FIELDS — see
    // `lib/defence/factClassifier.ts` for the rationale. The source
    // collector (`lib/packs/sources/fraudRiskSource.ts`) is now the
    // strict gate: it ONLY emits a section when Shopify returned a
    // favourable verdict (LOW/NONE risk_level, ACCEPT recommendation,
    // ≥1 positive fact). So any section reaching the classifier is
    // bank-safe by construction.
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
    expect(result.approved.find((f) => f.category === "fraud_screening")).toBeDefined();
    // And it must NOT be flagged as internal-only or submission-risk.
    expect(result.internalOnly.find((f) => f.category === "fraud_screening")).toBeUndefined();
  });

  it("fraud_risk_screening passes the actual positive fact PHRASES to the LLM, not just a count", () => {
    // Locks in the 2026-05-19 extractor fix. Before, the value
    // carried only `positiveFactCount` — the LLM had no specific
    // signals to cite and produced meaningless narrative like
    // "3 positive signals." After, the actual phrases reach
    // approvedFacts[].value.positiveFacts so the LLM can name them.
    const result = classifyFacts(
      baseInput({
        sections: [
          section({
            data: {
              positiveFacts: [
                "Card Verification Value (CVV) is correct",
                "Billing street address matches credit card's registered address",
                "Billing address ZIP or postal code matches the credit card's registered address",
              ],
              riskLevel: "NONE",
              recommendation: "ACCEPT",
              provider: "shopify",
            },
            fieldsProvided: ["fraud_risk_screening"],
          }),
        ],
      }),
    );
    const fact = result.approved.find((f) => f.category === "fraud_screening");
    expect(fact).toBeDefined();
    const v = fact!.value as {
      positiveFacts?: string[];
      positiveFactCount?: number;
      recommendation?: string;
    };
    expect(v.positiveFacts).toEqual([
      "Card Verification Value (CVV) is correct",
      "Billing street address matches credit card's registered address",
      "Billing address ZIP or postal code matches the credit card's registered address",
    ]);
    expect(v.positiveFactCount).toBe(3);
    expect(v.recommendation).toBe("ACCEPT");
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

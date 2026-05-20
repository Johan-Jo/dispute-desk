import { describe, it, expect } from "vitest";
import { buildEvidenceBasisRows } from "../evidenceBasisRows";
import type { EvidenceFact } from "../../types";

function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value: { avsResult: "Y", cvvResult: "M" },
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

describe("buildEvidenceBasisRows", () => {
  it("includes only bankEligible+includeInBankNarrative+!submissionRisk facts", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "f1" }),
      fact({ id: "f2", bankEligible: false }),
      fact({ id: "f3", includeInBankNarrative: false }),
      fact({ id: "f4", submissionRisk: true }),
      fact({ id: "f5", internalOnly: true, bankEligible: false }),
    ]);
    expect(rows.map((r) => r.factId)).toEqual(["f1"]);
  });

  it("orders rows by category rank, then label", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "policy", category: "policy_refund", label: "Refund policy", value: { acceptedAtCheckout: true } }),
      fact({ id: "delivery", category: "delivery_proof", label: "Delivery", value: { proofType: "delivered_confirmed" } }),
      fact({ id: "payment", category: "payment_authentication", label: "Payment auth" }),
    ]);
    expect(rows.map((r) => r.factId)).toEqual(["payment", "delivery", "policy"]);
  });

  it("renders translated AVS/CVV/3DS plain-language summary (no raw gateway codes)", () => {
    // Prefer the pre-translated verificationSummary built by
    // factClassifier.ts. Bank-facing prose must never quote the raw
    // single-letter codes (Y/M/N/etc.) — same rule the narrative obeys.
    const rows = buildEvidenceBasisRows([
      fact({
        value: {
          avsResult: "Y",
          cvvResult: "M",
          threeDS: true,
          verificationSummary:
            "the billing address matched the issuer's records and the card verification code matched the issuer's records",
        },
      }),
    ]);
    expect(rows[0].value).toContain("billing address matched");
    expect(rows[0].value).toContain("card verification code matched");
    expect(rows[0].value).toContain("3DS");
    // Belt-and-suspenders: raw codes must never leak.
    expect(rows[0].value).not.toMatch(/\bAVS [YN]\b/);
    expect(rows[0].value).not.toMatch(/\bCVV [MN]\b/);
  });

  it("falls back to inline translation when verificationSummary is absent (old facts)", () => {
    // Older facts (before verificationSummary was added) carry only
    // the raw codes. The formatter still translates rather than
    // quoting them verbatim.
    const rows = buildEvidenceBasisRows([
      fact({ value: { avsResult: "Y", cvvResult: "M", threeDS: true } }),
    ]);
    expect(rows[0].value).toContain("billing address matched");
    expect(rows[0].value).toContain("CVV matched");
    expect(rows[0].value).toContain("3DS");
    expect(rows[0].value).not.toMatch(/\bAVS Y\b/);
    expect(rows[0].value).not.toMatch(/\bCVV M\b/);
  });

  it("renders delivery proofType=delivered_confirmed", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "delivery_proof",
        label: "Delivery",
        value: { proofType: "delivered_confirmed", deliveredAt: "2026-05-12" },
      }),
    ]);
    expect(rows[0].value).toBe("Delivered 2026-05-12");
  });

  it("renders signature on delivery when proofType=signature_confirmed", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "delivery_proof",
        label: "Delivery",
        value: { proofType: "signature_confirmed", deliveredAt: "2026-05-12" },
      }),
    ]);
    expect(rows[0].value).toContain("Signature on delivery");
  });

  it("renders prior customer count (no prior chargebacks)", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "prior_customer_history",
        label: "Customer history",
        value: { priorOrderCount: 4 },
      }),
    ]);
    expect(rows[0].value).toBe("4 prior undisputed orders");
  });

  it("renders prior customer count with a prior-chargeback caveat", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "prior_customer_history",
        label: "Customer history",
        value: { priorOrderCount: 2, disputeFreeHistory: false },
      }),
    ]);
    expect(rows[0].value).toBe(
      "2 prior orders (account has prior chargebacks)",
    );
  });

  it("renders new-customer state when there are no prior orders", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "prior_customer_history",
        label: "Customer history",
        value: { priorOrderCount: 0 },
      }),
    ]);
    expect(rows[0].value).toBe("First order on this account");
  });

  it("empty input → empty rows", () => {
    expect(buildEvidenceBasisRows([])).toEqual([]);
  });

  it("excludes submissionRisk facts even when bankEligible+includeInBankNarrative are true", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "ip",
        category: "ip_location",
        bankEligible: true,
        includeInBankNarrative: true,
        submissionRisk: true,
      }),
    ]);
    expect(rows).toHaveLength(0);
  });
});

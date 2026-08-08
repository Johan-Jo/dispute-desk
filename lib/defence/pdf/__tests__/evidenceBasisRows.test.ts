import { describe, it, expect } from "vitest";
import { buildEvidenceBasisRows } from "../evidenceBasisRows";
import { classifyFacts, type ClassifyFactsInput } from "../../factClassifier";
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
    // Case-insensitive — the renderer capitalizes the leading
    // character at the boundary; the underlying summary is what this
    // test cares about.
    expect(rows[0].value).toMatch(/billing address matched/i);
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
    // Case-insensitive — the renderer capitalizes the leading
    // character at the boundary; the underlying translation is what
    // this test cares about.
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(rows[0].value).toContain("CVV matched");
    expect(rows[0].value).toContain("3DS");
    expect(rows[0].value).not.toMatch(/\bAVS Y\b/);
    expect(rows[0].value).not.toMatch(/\bCVV M\b/);
  });

  it("renders delivery proofType=delivered_confirmed with a formatted (not raw ISO) date", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "delivery_proof",
        label: "Delivery",
        value: { proofType: "delivered_confirmed", deliveredAt: "2026-07-06T18:16:00Z" },
      }),
    ]);
    // Clean bank-facing date, never the raw ISO string.
    expect(rows[0].value).toBe("Delivered Jul 6, 2026, 18:16 UTC");
    expect(rows[0].value).not.toContain("T18:16");
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

  it("renders prior customer count (verified: no prior chargebacks)", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "prior_customer_history",
        label: "Customer history",
        value: { priorOrderCount: 4, disputeFreeHistory: true },
      }),
    ]);
    expect(rows[0].value).toBe("4 prior undisputed orders");
  });

  // The word "undisputed" is a claim, and this row goes in the PDF the
  // issuer reads. An unverified history states the count and stops.
  it("omits 'undisputed' when the history was never verified", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "prior_customer_history",
        label: "Customer history",
        value: { priorOrderCount: 4, disputeFreeHistory: null },
      }),
    ]);
    expect(rows[0].value).toBe("4 prior orders on this account");
    expect(rows[0].value).not.toContain("undisputed");
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

  it("uses a defensive fallback when a bank-eligible fact has no count (legacy bypass)", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        category: "prior_customer_history",
        label: "Customer history",
        value: { priorOrderCount: 0 },
      }),
    ]);
    // First-time customers are categorized as supporting by the
    // canonical categorizer and never reach buildEvidenceBasisRows in
    // production. The fallback string keeps the cell debuggable if a
    // legacy fact slips through.
    expect(rows[0].value).toBe("Prior account history on file");
  });

  it("collapses the delivery_proof + shipping_tracking pair into one row", () => {
    // The delivery signal reaches the classifier under two sibling
    // categories carrying the SAME fulfillment payload. Without the
    // collapse both survive filtering and print an identical value
    // (blume-box dispute 3477c53f: "Delivery confirmation → Delivered
    // Jul 7" AND "Shipping tracking → Delivered Jul 7"). Keep the
    // delivery_proof row; drop the shipping_tracking sibling.
    const value = { proofType: "delivered_confirmed", deliveredAt: "2026-07-07T22:18:00Z" };
    const rows = buildEvidenceBasisRows([
      fact({ id: "delivery", category: "delivery_proof", label: "Delivery confirmation", value }),
      fact({ id: "tracking", category: "shipping_tracking", label: "Shipping tracking", value }),
    ]);
    expect(rows.map((r) => r.factId)).toEqual(["delivery"]);
    expect(rows[0].label).toBe("Delivery confirmation");
    expect(rows[0].value).toBe("Delivered Jul 7, 2026, 22:18 UTC");
  });

  it("keeps a lone shipping_tracking row when no delivery_proof is present", () => {
    // The collapse only drops the sibling when delivery_proof also
    // survives; a shipping_tracking fact on its own must still render.
    const rows = buildEvidenceBasisRows([
      fact({
        id: "tracking",
        category: "shipping_tracking",
        label: "Shipping tracking",
        value: { proofType: "delivered_confirmed", deliveredAt: "2026-07-07T22:18:00Z" },
      }),
    ]);
    expect(rows.map((r) => r.factId)).toEqual(["tracking"]);
    expect(rows[0].value).toBe("Delivered Jul 7, 2026, 22:18 UTC");
  });

  it("empty input → empty rows", () => {
    expect(buildEvidenceBasisRows([])).toEqual([]);
  });

  it("capitalizes the first character of every cell value", () => {
    // The classifier produces phrases that read naturally inside the
    // LLM narrative ("the billing address matched…"), but in the PDF's
    // Evidence Basis table each cell is a sentence-equivalent and must
    // start with a capital letter. The renderer normalizes at the
    // boundary, so this holds regardless of which category emits the
    // string.
    // The underlying AVS value is what authorizes the text (PR-C2) — a
    // summary alone renders nothing — so the fixture carries the code the
    // sentence describes.
    const rows = buildEvidenceBasisRows([
      fact({
        value: {
          avsResult: "Y",
          cvvResult: "N",
          verificationSummary:
            "the billing address matched the issuer's records",
        },
      }),
    ]);
    expect(rows[0].value.charAt(0)).toBe(
      rows[0].value.charAt(0).toUpperCase(),
    );
    expect(rows[0].value.startsWith("The billing address matched")).toBe(true);
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

/**
 * PR-C2 review (2026-08-08) — a payment-verification fact with no citable
 * content produces NO ROW.
 *
 * The legacy fallback returned the bare word "Authenticated" whenever it
 * could not build a phrase. On a CVV-only fact that is an unsupported
 * assertion of authentication, printed under a row labelled "Payment
 * authentication" — and one that survives every check aimed at the words
 * "CVV" or "verification code", because the claim is the ROW, not its text.
 *
 * The current classifier never produces such a fact (a CVV-only match is
 * `bankEligible: false` before it reaches here). These tests cover the fact
 * that is PERSISTED with stale flags: `defence_evidence_facts` rows written
 * before the split still say `bankEligible: true`, and a re-render must not
 * trust them.
 */
describe("buildEvidenceBasisRows — uncitable payment verification (PR-C2)", () => {
  const legacyCitableFlags = {
    bankEligible: true,
    includeInBankNarrative: true,
    submissionRisk: false,
  } as const;

  it("a legacy CVV-only fact with stale citable flags produces ZERO rows", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "cvv-only",
        value: { avsResult: "N", cvvResult: "M" },
        ...legacyCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("the row is ABSENT — not merely stripped of the words 'CVV' / 'verification code'", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "cvv-only", value: { avsResult: "N", cvvResult: "M" }, ...legacyCitableFlags }),
      fact({
        id: "order",
        category: "order_record",
        label: "Order record",
        value: {},
        ...legacyCitableFlags,
      }),
    ]);
    // The surviving row is the unrelated one; no payment row exists at all,
    // under any wording.
    expect(rows.map((r) => r.factId)).toEqual(["order"]);
    expect(rows.some((r) => r.category === "payment_authentication")).toBe(false);
    expect(rows.some((r) => r.label === "Payment authentication")).toBe(false);
    expect(rows.map((r) => r.value).join(" | ")).not.toMatch(/authenticated/i);
  });

  it("no row for a CVV-only fact whose AVS code is absent entirely", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "cvv-only", value: { cvvResult: "M" }, ...legacyCitableFlags }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("no row for a payment fact with neither an AVS match nor 3DS", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "empty", value: { avsResult: "N", cvvResult: "N" }, ...legacyCitableFlags }),
      fact({ id: "bare", value: {}, ...legacyCitableFlags }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("AVS-only still renders", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "avs", value: { avsResult: "Y", cvvResult: "N" }, ...legacyCitableFlags }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(rows[0].value).not.toMatch(/CVV/i);
  });

  it("AVS + CVV still renders both halves", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "both", value: { avsResult: "Y", cvvResult: "M" }, ...legacyCitableFlags }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(rows[0].value).toContain("CVV matched");
  });

  it("a current fact carrying verificationSummary still renders it", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "summary",
        value: {
          avsResult: "Y",
          cvvResult: "M",
          verificationSummary:
            "the billing address matched the issuer's records and the card verification code matched the issuer's records",
        },
        ...legacyCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
  });

  it("a 3DS-only fact still renders — 3DS is independently citable, AVS or no AVS", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "tds",
        label: "3-D Secure authentication",
        value: {
          threeDS: true,
          liabilityShift: true,
          eci: "02",
          dsTransactionId: "b3b905f0-1111-2222-3333-444455556666",
        },
        ...legacyCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toContain("3DS authenticated");
    expect(rows[0].value).toContain("ECI 02");
    expect(rows[0].value).toContain("DS transaction b3b905f0-1111-2222-3333-444455556666");
  });

  it("a CVV-only fact that ALSO carries citable 3DS renders the 3DS half only", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "cvv-plus-tds",
        value: { avsResult: "N", cvvResult: "M", threeDS: true, eci: "02" },
        ...legacyCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toContain("3DS authenticated");
    expect(rows[0].value).not.toMatch(/CVV|verification code|billing address/i);
  });
});

/**
 * A PERSISTED `verificationSummary` IS NOT CITATION AUTHORITY.
 *
 * The exact shapes below are what `factClassifier.extractValue` wrote BEFORE
 * PR-C2: `{ avsResult, cvvResult, verificationSummary }`, where the summary
 * was built whenever either half matched — so a CVV-only case carried
 * "the card verification code matched the issuer's records", and AVS `Z`
 * (street failed, postal matched) carried a "billing postal code matched"
 * clause the post-split scorer calls a non-match. Those rows also carry
 * `bankEligible: true` from the same era.
 *
 * The renderer reads the underlying codes through `readPaymentVerification`
 * FIRST and lets them decide whether anything may be said. A stored sentence
 * can only choose the register of text that the values already authorized.
 */
describe("buildEvidenceBasisRows — a persisted summary is not authority (PR-C2)", () => {
  const staleCitableFlags = {
    bankEligible: true,
    includeInBankNarrative: true,
    submissionRisk: false,
  } as const;

  /** Verbatim pre-split shape for a CVV-only match. */
  const HISTORICAL_CVV_ONLY = {
    avsResult: "N",
    cvvResult: "M",
    verificationSummary: "the card verification code matched the issuer's records",
  } as const;

  it("stale CVV-only summary + stale citable flags → zero rows", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "legacy-cvv", value: { ...HISTORICAL_CVV_ONLY }, ...staleCitableFlags }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("the stale summary's text never reaches the table under any row", () => {
    const rows = buildEvidenceBasisRows([
      fact({ id: "legacy-cvv", value: { ...HISTORICAL_CVV_ONLY }, ...staleCitableFlags }),
      fact({
        id: "order",
        category: "order_record",
        label: "Order record",
        value: {},
        ...staleCitableFlags,
      }),
    ]);
    expect(rows.map((r) => r.factId)).toEqual(["order"]);
    expect(rows.map((r) => r.value).join(" | ")).not.toMatch(
      /verification code|billing address|authenticated/i,
    );
  });

  it("the same shape WITH valid 3DS renders the 3DS text only", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "legacy-cvv-3ds",
        value: {
          ...HISTORICAL_CVV_ONLY,
          threeDS: true,
          liabilityShift: true,
          eci: "02",
          dsTransactionId: "b3b905f0-1111-2222-3333-444455556666",
        },
        ...staleCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toContain("3DS authenticated");
    expect(rows[0].value).toContain("ECI 02");
    expect(rows[0].value).not.toMatch(/verification code|billing address|CVV/i);
  });

  it("a summary with NO underlying AVS value at all → no payment-verification text", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "summary-only",
        value: {
          cvvResult: "M",
          verificationSummary: "the card verification code matched the issuer's records",
        },
        ...staleCitableFlags,
      }),
      fact({
        id: "summary-no-codes",
        value: {
          verificationSummary:
            "the billing address matched the issuer's records and the card verification code matched the issuer's records",
        },
        ...staleCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("a summary whose underlying AVS is uncitable (Z: street failed) → zero rows", () => {
    // Pre-split, AVS `Z` produced a bank-facing "billing postal code matched"
    // clause while the scorer graded the same code a non-match. The stored
    // sentence must not resurrect it.
    const rows = buildEvidenceBasisRows([
      fact({
        id: "legacy-z",
        value: {
          avsResult: "Z",
          cvvResult: "M",
          verificationSummary:
            "the billing postal code matched the issuer's records and the card verification code matched the issuer's records",
        },
        ...staleCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("AVS-only with valid underlying data still renders, from the values", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "legacy-avs",
        value: {
          avsResult: "Y",
          cvvResult: "N",
          verificationSummary: "the billing address matched the issuer's records",
        },
        ...staleCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(rows[0].value).not.toMatch(/verification code|CVV/i);
  });

  it("AVS+CVV with valid underlying data still renders both halves", () => {
    const rows = buildEvidenceBasisRows([
      fact({
        id: "legacy-both",
        value: {
          avsResult: "Y",
          cvvResult: "M",
          verificationSummary:
            "the billing address matched the issuer's records and the card verification code matched the issuer's records",
        },
        ...staleCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(rows[0].value).toContain("card verification code matched");
  });

  it("a stale summary cannot overstate what the values support", () => {
    // Underlying: address matched, security code did NOT. The stored sentence
    // claims both. The rendered row follows the values.
    const rows = buildEvidenceBasisRows([
      fact({
        id: "overstated",
        value: {
          avsResult: "Y",
          cvvResult: "N",
          verificationSummary:
            "the billing address matched the issuer's records and the card verification code matched the issuer's records",
        },
        ...staleCitableFlags,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toMatch(/billing address matched/i);
    expect(rows[0].value).not.toMatch(/verification code/i);
  });
});

/**
 * The upstream half of the same guarantee: the CURRENT classifier never hands
 * the renderer a citable CVV-only fact in the first place. The renderer fix
 * above is the second line, for facts persisted before the split.
 */
describe("classifier output for a CVV-only match (PR-C2)", () => {
  it("is merchant-visible, moderate, and bank-ineligible", () => {
    const result = classifyFacts({
      packageId: "pkg_1",
      sections: [
        {
          type: "payment",
          label: "Payment authentication",
          source: "shopify_order",
          data: { avsResultCode: "N", cvvResultCode: "M" },
          fieldsProvided: ["avs_cvv_match"],
        },
      ],
      evidenceItems: [],
      checklist: [],
      coverage: { state: "not_covered" },
      fatalLoss: { triggered: false, reason: null },
      caseStrength: "moderate",
      manualRows: [],
      reasonCodeModule: {
        allowedFactCategories: ["payment_authentication"],
        criticalCategories: [],
      } as unknown as ClassifyFactsInput["reasonCodeModule"],
    });

    const classified = result.approved.find(
      (f) => (f.value as { fieldKey?: string }).fieldKey === "avs_cvv_match",
    );
    expect(classified).toBeDefined();
    expect(classified?.merchantVisible).toBe(true);
    expect(classified?.strength).toBe("moderate");
    expect(classified?.bankEligible).toBe(false);
    expect(classified?.includeInBankNarrative).toBe(false);

    // And so it never reaches the table by the normal path either.
    expect(buildEvidenceBasisRows(result.approved)).toHaveLength(0);
  });
});

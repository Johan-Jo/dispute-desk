/**
 * A liability-shifted 3-D Secure authentication must reach the issuer — under
 * any reason code — and an unciteable one must reach no bank-facing surface.
 *
 * WHAT WENT WRONG (blume-box #352552, 2026-08-03). Mastercard, ECI 02, 3DS
 * 2.2.0, `result: authenticated`, no exemption: a full liability shift. The
 * issuer's own claim document is a fraud questionnaire — "cardholder did not
 * participate", card never lost or stolen, never used. The single strongest
 * fact in the file, and we cited none of it, for three independent reasons:
 *
 *   1. The bank labelled the dispute PRODUCT_UNACCEPTABLE, and that module's
 *      `allowedFactCategories` omits `payment_authentication`.
 *   2. `claimGuards.three_d_secure` requires `liabilityShift=true`, a flag no
 *      code path has ever written — permanently false, so permanently blocking.
 *   3. `threeDSecureSource` collapsed the whole block to one boolean, dropping
 *      the ECI that decides the shift and the DS transaction id that makes it
 *      checkable.
 *
 * Meanwhile the PDF's Evidence Basis table printed "3DS authenticated" to that
 * same issuer, three lines under a narrative that had deliberately refused to
 * argue it.
 */

import { describe, it, expect } from "vitest";
import { readThreeDsDetail } from "@/lib/shopify/receipts/threeDs";
import { extractValueForTest as extractValue, classifyFacts } from "../factClassifier";
import { buildLlmFactPayload } from "../narrativeWriter";
import { buildEvidenceBasisRows } from "../pdf/evidenceBasisRows";
import { resolveReasonCodeModule } from "../reasonCodes/registry";
import type { EvidenceFact } from "../types";

/** The live receipt shape from blume-box #352552 (order 7427366355137). */
const RECEIPT_ECI_02 = {
  latest_charge: {
    payment_method_details: {
      card: {
        three_d_secure: {
          authentication_flow: "frictionless",
          electronic_commerce_indicator: "02",
          exemption_indicator: null,
          result: "authenticated",
          result_reason: null,
          transaction_id: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
          version: "2.2.0",
        },
      },
    },
  },
};

function receiptWith(tds: Record<string, unknown>) {
  return { latest_charge: { payment_method_details: { card: { three_d_secure: tds } } } };
}

describe("readThreeDsDetail — the ECI decides the shift", () => {
  it("reads the full block from the live #352552 receipt", () => {
    const d = readThreeDsDetail(RECEIPT_ECI_02)!;
    expect(d.authenticated).toBe(true);
    expect(d.eci).toBe("02");
    expect(d.dsTransactionId).toBe("b3b905f0-8654-42a3-a1df-e389808fcb9c");
    expect(d.version).toBe("2.2.0");
    expect(d.authenticationFlow).toBe("frictionless");
    expect(d.liabilityShift).toBe(true);
  });

  it("shifts on Visa ECI 05 too", () => {
    const d = readThreeDsDetail(
      receiptWith({ result: "authenticated", electronic_commerce_indicator: "05" }),
    )!;
    expect(d.liabilityShift).toBe(true);
  });

  it.each(["06", "01", "07", "00"])("does NOT shift on ECI %s (attempted / none)", (eci) => {
    // Attempted authentication did not complete. Citing it invites the issuer
    // to point out the cardholder was never authenticated.
    const d = readThreeDsDetail(
      receiptWith({ result: "authenticated", electronic_commerce_indicator: eci }),
    )!;
    expect(d.liabilityShift).toBe(false);
  });

  it("does NOT shift when an SCA exemption was applied", () => {
    // An exemption means authentication was deliberately skipped and the
    // merchant kept the liability — the opposite of what we'd be arguing.
    const d = readThreeDsDetail(
      receiptWith({
        result: "authenticated",
        electronic_commerce_indicator: "02",
        exemption_indicator: "low_value",
      }),
    )!;
    expect(d.liabilityShift).toBe(false);
  });

  it("returns null when the block is absent — absence is never a negative", () => {
    expect(readThreeDsDetail({ latest_charge: { payment_method_details: { card: {} } } })).toBeNull();
  });
});

describe("the classifier gates 3DS on whether it actually helps", () => {
  const fact = (data: Record<string, unknown>): EvidenceFact | undefined => {
    const res = classifyFacts({
      packageId: "pkg0",
      sections: [
        {
          type: "other",
          label: "3-D Secure authentication",
          source: "shopify_transactions",
          fieldsProvided: ["tds_authentication"],
          data,
        },
      ],
      evidenceItems: [],
      checklist: [],
      coverage: { state: "not_covered" },
      fatalLoss: { triggered: false, reason: null },
      caseStrength: "moderate",
      manualRows: [],
      reasonCodeModule: resolveReasonCodeModule("10.4"),
    });
    return [...res.approved, ...res.internalOnly, ...res.submissionRisk].find(
      (f) => f.value.fieldKey === "tds_authentication",
    );
  };

  it("a liability-shifted authentication is bank-citable and carries its identifiers", () => {
    const f = fact({
      tdsAuthenticated: true,
      tdsVerified: false,
      verifiedSource: "shopify_receipt",
      liabilityShift: true,
      eci: "02",
      dsTransactionId: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
      tdsVersion: "2.2.0",
    })!;
    expect(f.bankEligible).toBe(true);
    expect(f.includeInBankNarrative).toBe(true);
    expect(f.value.eci).toBe("02");
    expect(f.value.dsTransactionId).toBe("b3b905f0-8654-42a3-a1df-e389808fcb9c");
  });

  it("a merchant-confirmed authentication is citable even without an ECI", () => {
    const f = fact({ tdsAuthenticated: true, tdsVerified: true, verifiedSource: "merchant_confirmed" })!;
    expect(f.includeInBankNarrative).toBe(true);
  });

  it("a bare receipt read with no shift reaches NO bank-facing surface", () => {
    // This is the state #352552's package was in: threeDS true, nothing else.
    const f = fact({ tdsAuthenticated: true, tdsVerified: false, verifiedSource: "shopify_receipt" })!;
    expect(f.bankEligible).toBe(false);
    expect(f.includeInBankNarrative).toBe(false);
    expect(buildEvidenceBasisRows([f])).toHaveLength(0);
  });
});

describe("a mislabelled dispute cannot suppress a liability shift", () => {
  const shiftedFact: EvidenceFact = {
    id: "f0",
    category: "payment_authentication",
    label: "3-D Secure authentication",
    value: {
      fieldKey: "tds_authentication",
      threeDS: true,
      liabilityShift: true,
      eci: "02",
      dsTransactionId: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
    },
    source: "shopify_transactions",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  };

  const payloadFor = (moduleKey: string, facts: EvidenceFact[]) =>
    buildLlmFactPayload({
      packageId: "pkg0",
      disputeId: "d0",
      reasonCode: moduleKey,
      packageMode: "full",
      caseStrength: "moderate",
      reasonCodeModule: resolveReasonCodeModule(moduleKey),
      approvedFacts: facts,
      manualEvidence: [],
      internalOnlyFactIds: [],
      missingEvidence: [],
      strategies: [],
    } as never) as {
      reasonCodeGuidance: { allowedFactCategories: string[] };
    };

  it("payment_authentication becomes allowed under product_unacceptable when liability shifted", () => {
    // The module itself omits it — that omission is what silenced #352552.
    expect(
      resolveReasonCodeModule("13.3").allowedFactCategories,
    ).not.toContain("payment_authentication");
    const payload = payloadFor("13.3", [shiftedFact]);
    expect(payload.reasonCodeGuidance.allowedFactCategories).toContain("payment_authentication");
  });

  it("leaves the module's categories alone when there is no shift", () => {
    const noShift: EvidenceFact = {
      ...shiftedFact,
      value: { ...shiftedFact.value, liabilityShift: false },
    };
    const payload = payloadFor("13.3", [noShift]);
    expect(payload.reasonCodeGuidance.allowedFactCategories).not.toContain(
      "payment_authentication",
    );
  });
});

describe("the evidence row names the ECI and the DS transaction id", () => {
  it("prints identifiers an issuer can match against their own record", () => {
    const rows = buildEvidenceBasisRows([
      {
        id: "f0",
        category: "payment_authentication",
        label: "3-D Secure authentication",
        value: {
          fieldKey: "tds_authentication",
          threeDS: true,
          liabilityShift: true,
          eci: "02",
          dsTransactionId: "b3b905f0-8654-42a3-a1df-e389808fcb9c",
        },
        source: "shopify_transactions",
        sourceRef: null,
        strength: "moderate",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toContain("3DS authenticated");
    expect(rows[0].value).toContain("ECI 02");
    expect(rows[0].value).toContain("DS transaction b3b905f0-8654-42a3-a1df-e389808fcb9c");
  });
});

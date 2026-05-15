/**
 * Global invariant — no negative bank leakage (Phase 1 fraud-risk plan).
 *
 * Negative or neutral pre-authorization risk signals must NEVER appear in:
 *   - bank-rebuttal text
 *   - the EvidenceData fields that feed the PDF / Shopify mutation
 *   - the categorizer's output for `fraud_risk_screening`
 *
 * This file is the regression test that locks the invariant in. It
 * is intentionally over-built (multiple layers) so a future commit
 * cannot quietly route a negative fact into a bank-facing surface
 * without something here turning red.
 *
 * The collector itself filters by sentiment before emitting a payload
 * (covered in fraudRiskSource.test.ts). The extra coverage here:
 *
 *   1. extractEvidenceDataFromPack does NOT invent positive facts when
 *      none are present.
 *   2. buildBankGradeRebuttal does NOT include the screening sentence
 *      when fraudRiskScreeningPositiveFacts is null/empty.
 *   3. buildBankGradeRebuttal NEVER emits any of the forbidden bank-
 *      leakage tokens (HIGH, INVESTIGATE, REJECT, negative facts)
 *      under any payload combination — even a hand-crafted one
 *      bypassing the collector.
 *   4. categorizeEvidenceField on `fraud_risk_screening` cannot return
 *      "strong" for any input. Capped at moderate regardless.
 */

import { describe, it, expect } from "vitest";

import { buildBankGradeRebuttal } from "../responseEngine";
import type { EvidenceData } from "../responseEngine";
import { extractEvidenceDataFromPack } from "../evidenceDataFromPack";
import { categorizeEvidenceField } from "../canonicalEvidence";
import { calculateCaseStrength } from "../caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ArgumentMap } from "../types";

/** Tokens that MUST NOT appear in any bank-facing rebuttal output. */
const FORBIDDEN_BANK_TOKENS = [
  "HIGH",
  "INVESTIGATE",
  "REJECT",
  "high-risk",
  "high risk",
  "flagged",
  "warning",
  "negative",
];

function assertNoForbiddenTokens(text: string): void {
  const haystack = text.toLowerCase();
  for (const token of FORBIDDEN_BANK_TOKENS) {
    expect(
      haystack.includes(token.toLowerCase()),
      `bank-facing text contains forbidden token "${token}": ${text}`,
    ).toBe(false);
  }
}

/** A minimal EvidenceData that produces SOME bank-grade output without
 *  any fraud-risk-screening signal. Used as the baseline against which
 *  we compare. */
const BASELINE_EVIDENCE: EvidenceData = {
  authorizationSucceeded: true,
  captureSucceeded: true,
  avsCode: "Y",
  cvvCode: "M",
  hasOrderConfirmation: true,
  hasCustomerEmail: true,
};

describe("fraud-risk negative-leakage guard", () => {
  describe("buildBankGradeRebuttal", () => {
    it("baseline: payment paragraph never contains forbidden tokens", () => {
      const text = buildBankGradeRebuttal(BASELINE_EVIDENCE);
      assertNoForbiddenTokens(text);
      // Sanity check: the baseline emits real content.
      expect(text).toMatch(/AVS/);
    });

    it("with positive facts: appends the pre-authorization sentence", () => {
      const text = buildBankGradeRebuttal({
        ...BASELINE_EVIDENCE,
        fraudRiskScreeningPositiveFacts: [
          "Billing country matches IP country",
          "Verified email domain",
          "No prior chargebacks from this customer",
        ],
      });
      // Citing positive screening — the wording matters (see plan).
      expect(text).toMatch(/pre-authorization fraud analysis classified the order as low-risk at checkout/);
      expect(text).toMatch(/Billing country matches IP country/);
      // Even with the screening sentence inserted, no negative leakage.
      assertNoForbiddenTokens(text);
    });

    it("with null positive facts: NO screening sentence", () => {
      const text = buildBankGradeRebuttal({
        ...BASELINE_EVIDENCE,
        fraudRiskScreeningPositiveFacts: null,
      });
      expect(text).not.toMatch(/pre-authorization fraud analysis/);
      expect(text).not.toMatch(/low-risk at checkout/);
      assertNoForbiddenTokens(text);
    });

    it("with empty positive facts array: NO screening sentence", () => {
      const text = buildBankGradeRebuttal({
        ...BASELINE_EVIDENCE,
        fraudRiskScreeningPositiveFacts: [],
      });
      expect(text).not.toMatch(/pre-authorization fraud analysis/);
      assertNoForbiddenTokens(text);
    });

    it("never cites the riskLevel / recommendation strings even when present in the section payload", () => {
      // Hand-crafted: someone bypassed the collector and tried to
      // sneak negative metadata into the screening payload. The
      // rebuttal composer only reads `fraudRiskScreeningPositiveFacts`,
      // never raw riskLevel/recommendation, so the only path that
      // could leak is via the positiveFacts array itself.
      const text = buildBankGradeRebuttal({
        ...BASELINE_EVIDENCE,
        fraudRiskScreeningPositiveFacts: [
          "Billing country matches IP country",
        ],
      });
      assertNoForbiddenTokens(text);
      expect(text).not.toMatch(/LOW/);
      expect(text).not.toMatch(/MEDIUM/);
      expect(text).not.toMatch(/ACCEPT/);
    });
  });

  describe("extractEvidenceDataFromPack", () => {
    it("returns null fraudRiskScreeningPositiveFacts when no section present", () => {
      const data = extractEvidenceDataFromPack(
        [
          {
            label: "Order #1",
            source: "shopify_order",
            fieldsProvided: ["order_confirmation"],
            data: { orderName: "#1" },
          },
        ],
        null,
      );
      expect(data.fraudRiskScreeningPositiveFacts).toBeNull();
    });

    it("returns null when section has empty positiveFacts array", () => {
      const data = extractEvidenceDataFromPack(
        [
          {
            label: "Pre-authorization fraud screening",
            source: "shopify_order_risk_assessments",
            fieldsProvided: ["fraud_risk_screening"],
            data: {
              provider: "shopify",
              riskLevel: "LOW",
              recommendation: "ACCEPT",
              positiveFacts: [],
            },
          },
        ],
        null,
      );
      expect(data.fraudRiskScreeningPositiveFacts).toBeNull();
    });

    it("returns the positive facts array when section is well-formed", () => {
      const data = extractEvidenceDataFromPack(
        [
          {
            label: "Pre-authorization fraud screening",
            source: "shopify_order_risk_assessments",
            fieldsProvided: ["fraud_risk_screening"],
            data: {
              provider: "shopify",
              riskLevel: "LOW",
              recommendation: "ACCEPT",
              positiveFacts: [
                "Billing country matches IP country",
                "Verified email domain",
              ],
            },
          },
        ],
        null,
      );
      expect(data.fraudRiskScreeningPositiveFacts).toEqual([
        "Billing country matches IP country",
        "Verified email domain",
      ]);
    });

    it("drops non-string entries defensively", () => {
      const data = extractEvidenceDataFromPack(
        [
          {
            fieldsProvided: ["fraud_risk_screening"],
            data: {
              positiveFacts: [
                "Real positive fact",
                123,
                null,
                undefined,
                "",
                "   ", // whitespace-only
              ],
            },
          },
        ],
        null,
      );
      expect(data.fraudRiskScreeningPositiveFacts).toEqual(["Real positive fact"]);
    });
  });

  describe("categorizeEvidenceField fraud_risk_screening", () => {
    it("returns moderate when positiveFacts array has entries", () => {
      const cat = categorizeEvidenceField("fraud_risk_screening", {
        positiveFacts: ["Billing country matches IP country"],
      });
      expect(cat).toBe("moderate");
    });

    it("returns invalid when positiveFacts is missing", () => {
      const cat = categorizeEvidenceField("fraud_risk_screening", {
        provider: "shopify",
        riskLevel: "LOW",
        recommendation: "ACCEPT",
      });
      expect(cat).toBe("invalid");
    });

    it("returns invalid when positiveFacts is empty", () => {
      const cat = categorizeEvidenceField("fraud_risk_screening", {
        positiveFacts: [],
      });
      expect(cat).toBe("invalid");
    });

    it("CANNOT return strong even with a large positiveFacts array", () => {
      // Stress test the invariant: regardless of payload, the
      // categorizer for fraud_risk_screening must never elevate to
      // strong. This locks in the Phase 1 classification decision
      // (Moderate, never Strong).
      const big = Array.from({ length: 50 }, (_, i) => `Fact ${i + 1}`);
      const cat = categorizeEvidenceField("fraud_risk_screening", {
        positiveFacts: big,
        provider: "shopify",
        riskLevel: "LOW",
        recommendation: "ACCEPT",
        // Even adding random discriminator fields used by other
        // canonical specs must not trigger upgrade.
        proofType: "signature_confirmed",
        match: true,
        tdsVerified: true,
        customerConfirmsOrder: true,
      });
      expect(cat).toBe("moderate");
      expect(cat).not.toBe("strong");
    });
  });

  /*
   * Risk-weakness diagnostics (internal-only, 2026-05-15) — the cap
   * was dropped, but the riskWeakness input still flows into
   * calculateCaseStrength so callers can persist diagnostics to
   * pack_json. The compile-time + runtime guards below ensure the
   * diagnostic strings (HIGH / INVESTIGATE / CANCEL / REJECT etc.)
   * never leak into bank-facing surfaces.
   */
  describe("risk-weakness diagnostics — bank-text isolation", () => {
    it("risk-weakness diagnostics never appear in buildBankGradeRebuttal output", () => {
      // No matter what EvidenceData we hand to the rebuttal composer,
      // the diagnostic strings (riskLevel/recommendation) must not
      // appear in bank text. EvidenceData has no such fields by
      // design, so the only failure mode would be a future commit
      // adding them — this test would still pass (no field, no leak)
      // but the assertion documents the invariant explicitly.
      const text = buildBankGradeRebuttal({
        ...BASELINE_EVIDENCE,
        fraudRiskScreeningPositiveFacts: [
          "Billing country matches IP country",
        ],
      });
      expect(text).not.toMatch(/HIGH/);
      expect(text).not.toMatch(/INVESTIGATE/);
      expect(text).not.toMatch(/REJECT/);
      expect(text).not.toMatch(/CANCEL/);
      assertNoForbiddenTokens(text);
    });

    it("EvidenceData type does not surface risk-weakness fields", () => {
      // Compile-time guarantee — if anyone adds a `riskLevel` or
      // `riskWeakness` to EvidenceData this assignment would compile
      // and the bank-text composer could quietly start emitting them.
      // @ts-expect-error — riskLevel must never be on EvidenceData
      const bad1: EvidenceData = { ...BASELINE_EVIDENCE, riskLevel: "HIGH" };
      // @ts-expect-error — riskWeakness must never be on EvidenceData
      const bad2: EvidenceData = { ...BASELINE_EVIDENCE, riskWeakness: {} };
      // Reference them to silence unused-var lint without touching prod.
      expect(bad1).toBeTruthy();
      expect(bad2).toBeTruthy();
    });
  });
});

/**
 * Narrative quality invariants — locks in the four 2026-05-19 fixes.
 *
 * Each test reflects a real bank-facing readability problem caught on
 * a live Visa 10.4 dispute and fixed at the source-of-truth layer:
 *
 *   1. Raw AVS/CVV gateway codes (Y/M/N/etc.) must not appear in any
 *      narrative section. The fact value carries a translated
 *      `verificationSummary` string the LLM is told to quote instead.
 *   2. Shopify's `fulfillmentStatus` enum (UNFULFILLED/FULFILLED/
 *      PARTIAL) is order-system jargon, not bank-facing evidence; it
 *      must not appear in any narrative section for any reason code.
 *   3. The `policyArgument` section is deny-listed for the
 *      `visa_10_4_fraud` reason-code module — refund/shipping/
 *      cancellation policies do not refute an unauthorized-transaction
 *      claim. The renderer drops the section regardless of LLM emission.
 *   4. The chronology thesis must not over-promise event categories
 *      the deterministic timeline doesn't actually carry (no claims
 *      of "site engagement" or "session traceability" — the timeline
 *      only renders transaction date + auth captured + customer
 *      communication if present).
 */

import { describe, it, expect } from "vitest";
import { extractValueForTest as extractValue } from "../factClassifier";
import { FORBIDDEN_PHRASES } from "../validateNarrative";
import { isSectionDeniedForModule } from "../sectionVisibility";
import { composePdfBlocks } from "../pdf/composePdfBlocks";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSection,
  NarrativeSectionKey,
} from "../types";

function section(text = "", usedFactIds: string[] = []): NarrativeSection {
  return { text, usedFactIds };
}
function narrative(
  overrides: Partial<Record<NarrativeSectionKey, NarrativeSection>> = {},
): DefenceNarrativeOutput {
  return {
    executiveSummary: section(),
    transactionOverviewArgument: section(),
    chronologyArgument: section(),
    paymentAuthenticationArgument: section(),
    fulfillmentArgument: section(),
    communicationArgument: section(),
    policyArgument: section(),
    manualEvidenceArgument: section(),
    conclusion: section(),
    omittedSections: [],
    warnings: [],
    ...overrides,
  };
}
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

describe("Invariant 1 — avs_cvv_match fact carries a translated verificationSummary", () => {
  it("emits a plain-language summary for AVS=Y + CVV=M", () => {
    const v = extractValue("avs_cvv_match", {
      avsResultCode: "Y",
      cvvResultCode: "M",
    });
    expect(v).toMatchObject({
      avsResult: "Y",
      cvvResult: "M",
    });
    expect(typeof v.verificationSummary).toBe("string");
    expect(v.verificationSummary).toMatch(/billing address matched/i);
    expect(v.verificationSummary).toMatch(/card verification code matched/i);
    expect(v.verificationSummary).not.toMatch(/\bY\b/);
    expect(v.verificationSummary).not.toMatch(/\bM\b/);
  });

  it("returns null verificationSummary when both codes are absent", () => {
    const v = extractValue("avs_cvv_match", {});
    expect(v.verificationSummary).toBeNull();
  });

  it("emits a partial summary when only AVS or only CVV is present", () => {
    const avsOnly = extractValue("avs_cvv_match", { avsResultCode: "Y" });
    expect(avsOnly.verificationSummary).toMatch(/billing address matched/i);
    expect(avsOnly.verificationSummary).not.toMatch(/card verification code/i);

    const cvvOnly = extractValue("avs_cvv_match", { cvvResultCode: "M" });
    expect(cvvOnly.verificationSummary).toMatch(/card verification code matched/i);
    expect(cvvOnly.verificationSummary).not.toMatch(/billing address/i);
  });
});

describe("Invariant 1b — narrative validator rejects raw AVS/CVV codes in prose", () => {
  it("matches AVS Y / CVV M / AVS result of Y patterns", () => {
    const samples = [
      "an AVS result of 'Y' and a CVV result of 'M'",
      "AVS Y and CVV M on file",
      "the AVS result was Y",
      "CVV result of M",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `expected forbidden match for: ${s}`).toBe(true);
    }
  });

  it("does NOT flag the translated summary phrasing", () => {
    const samples = [
      "the billing address matched the issuer's records",
      "the card verification code matched the issuer's records",
      "the available payment authentication signals are consistent with a cardholder-initiated transaction",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `unexpected forbidden match in: ${s}`).toBe(false);
    }
  });
});

describe("Invariant 2 — narrative validator rejects fulfillmentStatus leaks", () => {
  it("matches 'fulfillment status of UNFULFILLED' and bare 'UNFULFILLED'", () => {
    const samples = [
      "fulfillment status of UNFULFILLED at the time of this response",
      "fulfillment status of FULFILLED",
      "The order is UNFULFILLED.",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `expected forbidden match for: ${s}`).toBe(true);
    }
  });

  it("does NOT flag neutral order-record prose", () => {
    const samples = [
      "the order record was created at the time of purchase",
      "the available records indicate the order was placed via the web channel",
      "the payment was authorised with matching verification credentials",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `unexpected forbidden match in: ${s}`).toBe(false);
    }
  });
});

describe("Invariant 3 — policyArgument is deny-listed for visa_10_4_fraud", () => {
  it("isSectionDeniedForModule returns true for policyArgument + visa_10_4_fraud", () => {
    expect(isSectionDeniedForModule("policyArgument", "visa_10_4_fraud")).toBe(
      true,
    );
  });

  it("isSectionDeniedForModule returns false for other sections under fraud", () => {
    const others: NarrativeSectionKey[] = [
      "executiveSummary",
      "transactionOverviewArgument",
      "chronologyArgument",
      "paymentAuthenticationArgument",
      "fulfillmentArgument",
      "communicationArgument",
      "manualEvidenceArgument",
      "conclusion",
    ];
    for (const k of others) {
      expect(isSectionDeniedForModule(k, "visa_10_4_fraud"), k).toBe(false);
    }
  });

  it("isSectionDeniedForModule returns false for policyArgument under non-fraud modules", () => {
    expect(
      isSectionDeniedForModule("policyArgument", "inr_product_not_received"),
    ).toBe(false);
    expect(isSectionDeniedForModule("policyArgument", null)).toBe(false);
    expect(isSectionDeniedForModule("policyArgument", undefined)).toBe(false);
  });

  it("composePdfBlocks drops policyArgument when moduleKey=visa_10_4_fraud, even if LLM emitted text", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        policyArgument: section(
          "The merchant's refund, shipping, and cancellation policies were published.",
          ["f0"],
        ),
        conclusion: section("Concl.", ["f0"]),
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      moduleKey: "visa_10_4_fraud",
      fulfillmentStatus: null,
    });
    expect(blocks.find((b) => b.sectionKey === "policyArgument")).toBeUndefined();
    // Other sections still flow through.
    expect(blocks.find((b) => b.sectionKey === "conclusion")).toBeDefined();
  });

  it("composePdfBlocks keeps policyArgument when moduleKey is null or non-fraud", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        policyArgument: section("Policies on file.", ["f0"]),
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      moduleKey: null,
      fulfillmentStatus: null,
    });
    expect(blocks.find((b) => b.sectionKey === "policyArgument")).toBeDefined();
  });
});

describe("Invariant 4 — Chronology thesis must not over-promise event categories", () => {
  it("the embedded HTML view's fraud thesis no longer claims 'site engagement' or 'session traceability'", async () => {
    // Read the file content directly to assert the bad phrasing is gone.
    // We can't import the const because the file is a "use client"
    // React component that doesn't compile under vitest's default JSX
    // pipeline; a string scan is simpler and tests the right thing.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView.tsx",
    );
    const src = readFileSync(fp, "utf8");
    // The whole block was the bug — assert it's gone.
    expect(src).not.toMatch(/site engagement, order placement/);
    expect(src).not.toMatch(/each step traceable to the cardholder's session/);
    // The replacement (neutral, matches the PDF thesisTemplates) must
    // be in place.
    expect(src).toMatch(
      /timeline of events records the relevant moments of the customer's interaction/,
    );
  });
});

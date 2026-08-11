/**
 * Deterministic claim/document validation — CP-B §3.
 *
 * Two properties are asserted here and nowhere else: a failure is a REFUSAL
 * (never a warning, never a score), and the verdict is a function of the
 * document alone — same input, same codes, byte for byte.
 */

import { describe, expect, it } from "vitest";
import {
  FIXTURE_REVIEW_REQUIRED_NO_SAFE,
  FIXTURE_REVIEW_REQUIRED_SAFE,
} from "@/lib/pipeline/contracts/__fixtures__/cases";
import { validatePackageDocument } from "..";
import type { ComposedDocumentBlock, EvidenceFact } from "../../types";

function fact(over: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "review_required_safe#delivery",
    category: "delivery_proof",
    label: "Delivery confirmation",
    value: { fieldKey: "delivery_proof", proofType: "delivered_confirmed" },
    source: "shopify_fulfillments",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    ...over,
  };
}

function block(over: Partial<ComposedDocumentBlock> = {}): ComposedDocumentBlock {
  return {
    sectionKey: "fulfillmentArgument",
    heading: "Fulfilment",
    thesisText: "",
    llmText: "The carrier recorded delivery on 12 May 2026 (PostNord, tracking 1234567890).",
    fallbackText: "",
    usedFactIds: ["review_required_safe#delivery"],
    ...over,
  };
}

function validate(over: Partial<Parameters<typeof validatePackageDocument>[0]> = {}) {
  return validatePackageDocument({
    plan: FIXTURE_REVIEW_REQUIRED_SAFE.plan,
    blocks: [block()],
    includedFacts: [fact()],
    orphaned: [],
    missingRecordIds: [],
    packageMode: "full",
    ...over,
  });
}

describe("validatePackageDocument", () => {
  it("passes a document composed only from approved support", () => {
    expect(validate()).toEqual({ passed: true, failureCodes: [] });
  });

  it("refuses when the plan holds no safe argument", () => {
    const result = validate({ plan: FIXTURE_REVIEW_REQUIRED_NO_SAFE.plan, includedFacts: [] });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("no_safe_argument");
  });

  it("refuses an orphaned claim — never downgrades it to a warning", () => {
    const result = validate({
      orphaned: [
        { sectionKey: "paymentAuthenticationArgument", unsupportedFactIds: ["review_required_safe#tds"] },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("orphaned_claim");
  });

  it("refuses when the plan and the fact set were derived from different inputs", () => {
    const result = validate({ missingRecordIds: ["review_required_safe#delivery"] });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("plan_fact_mismatch");
  });

  it("refuses an empty document — a letter that argues nothing still asserts", () => {
    const result = validate({ blocks: [] });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("empty_document");
  });

  it("refuses a retired delivery key surviving in an included fact (C-11)", () => {
    const result = validate({
      includedFacts: [
        fact({ value: { fieldKey: "delivery_proof", deliveredToVerifiedAddress: true } }),
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("retired_delivery_fact");
  });

  it("refuses an affirmative address-delivery claim in ANY prose layer", () => {
    for (const layer of ["thesisText", "llmText", "fallbackText"] as const) {
      const result = validate({
        blocks: [
          block({
            thesisText: "",
            llmText: "",
            fallbackText: "",
            [layer]: "The parcel was delivered to the cardholder's verified address.",
          }),
        ],
      });
      expect(result.passed, layer).toBe(false);
      expect(result.failureCodes).toContain("unauthorized_claim");
    }
  });

  it("refuses a forbidden phrase", () => {
    const result = validate({
      blocks: [block({ llmText: "This is irrefutable evidence the charge was valid." })],
    });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("forbidden_phrase");
  });

  it("refuses a claim the surviving facts no longer support", () => {
    // The 3-D Secure claim's support was excluded by the plan, so the guard
    // keyed on `three_d_secure_present` fires against the remaining facts.
    const result = validate({
      blocks: [
        block({
          sectionKey: "paymentAuthenticationArgument",
          llmText: "The transaction was authenticated with 3-D Secure.",
          usedFactIds: [],
        }),
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.failureCodes).toContain("unsupported_claim");
  });

  it("returns stable, sorted, de-duplicated codes", () => {
    const result = validate({
      blocks: [],
      plan: FIXTURE_REVIEW_REQUIRED_NO_SAFE.plan,
      includedFacts: [],
      orphaned: [{ sectionKey: "conclusion", unsupportedFactIds: ["x"] }],
    });
    expect(result.failureCodes).toEqual([...result.failureCodes].sort());
    expect(new Set(result.failureCodes).size).toBe(result.failureCodes.length);
  });

  it("is DETERMINISTIC — the same document validates identically on every run", () => {
    const args = {
      blocks: [block({ llmText: "This is irrefutable." })],
      orphaned: [{ sectionKey: "conclusion" as const, unsupportedFactIds: ["x"] }],
    };
    expect(validate(args)).toEqual(validate(args));
  });
});

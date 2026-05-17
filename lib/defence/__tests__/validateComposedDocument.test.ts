import { describe, it, expect } from "vitest";
import {
  validateComposedDocument,
  summariseComposedErrors,
  runPhraseAndGuardChecks,
} from "../validateNarrative";
import type {
  ComposedDocumentBlock,
  EvidenceFact,
  NarrativeSectionKey,
} from "../types";

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

function block(overrides: Partial<ComposedDocumentBlock> = {}): ComposedDocumentBlock {
  return {
    sectionKey: "executiveSummary" as NarrativeSectionKey,
    heading: "Executive Summary",
    thesisText: "",
    llmText: "",
    fallbackText: "",
    usedFactIds: [],
    ...overrides,
  };
}

describe("validateComposedDocument", () => {
  it("passes on a clean block set", () => {
    const result = validateComposedDocument({
      blocks: [
        block({
          thesisText: "The approved evidence supporting the merchant's position is summarised below.",
          llmText: "The available records support the cardholder-initiated transaction.",
        }),
      ],
      approvedFacts: [fact()],
      packageMode: "full",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a banned phrase in the THESIS layer and tags it correctly", () => {
    const result = validateComposedDocument({
      blocks: [
        block({
          thesisText:
            "The approved evidence establishes that the transaction was authorised by the cardholder.",
          llmText: "Clean LLM prose.",
        }),
      ],
      approvedFacts: [fact()],
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    const thesisFailure = result.errors.find((e) => e.layer === "thesis");
    expect(thesisFailure).toBeDefined();
    expect(thesisFailure?.rule).toBe("forbidden_phrase");
    expect(thesisFailure?.section).toBe("executiveSummary");
  });

  it("rejects a banned phrase in the LLM layer and tags it correctly", () => {
    const result = validateComposedDocument({
      blocks: [
        block({
          thesisText: "Clean thesis.",
          llmText: "This is irrefutable evidence of the cardholder's intent.",
        }),
      ],
      approvedFacts: [fact()],
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    const llmFailure = result.errors.find((e) => e.layer === "llm");
    expect(llmFailure).toBeDefined();
    expect(llmFailure?.rule).toBe("forbidden_phrase");
    expect(llmFailure?.evidenceText?.toLowerCase()).toBe("irrefutable");
  });

  it("rejects a banned phrase in the FALLBACK layer and tags it correctly", () => {
    const result = validateComposedDocument({
      blocks: [
        block({
          sectionKey: "fulfillmentArgument",
          fallbackText: "The order was delivered to the customer.",
        }),
      ],
      // No delivery_proof — claim guard should fire on the fallback text.
      approvedFacts: [fact()],
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    const fallbackFailure = result.errors.find((e) => e.layer === "fallback");
    expect(fallbackFailure).toBeDefined();
    expect(fallbackFailure?.rule).toBe("unsupported_claim");
  });

  it("emits ONE error per matching pattern per layer (no cross-layer bleed)", () => {
    const result = validateComposedDocument({
      blocks: [
        block({
          thesisText: "An undeniable record of fact.",
          llmText: "An undeniable record of fact.",
          fallbackText: "An undeniable record of fact.",
        }),
      ],
      approvedFacts: [fact()],
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.filter((e) => e.layer === "thesis")).toHaveLength(1);
    expect(result.errors.filter((e) => e.layer === "llm")).toHaveLength(1);
    expect(result.errors.filter((e) => e.layer === "fallback")).toHaveLength(1);
  });

  it("narrow-mode aggressive phrase fires on every layer it appears in", () => {
    const result = validateComposedDocument({
      blocks: [
        block({
          thesisText: "The dispute is invalid based on the records.",
          llmText: "Some neutral sentence.",
        }),
      ],
      approvedFacts: [fact()],
      packageMode: "narrow",
    });
    expect(result.ok).toBe(false);
    const aggressive = result.errors.find(
      (e) => e.rule === "narrow_mode_aggressive_conclusion",
    );
    expect(aggressive).toBeDefined();
    expect(aggressive?.layer).toBe("thesis");
  });

  it("ignores empty sub-texts", () => {
    // Empty strings should produce no errors regardless of layer.
    const result = validateComposedDocument({
      blocks: [block({ thesisText: "", llmText: "", fallbackText: "" })],
      approvedFacts: [fact()],
      packageMode: "full",
    });
    expect(result.ok).toBe(true);
  });

  it("summariseComposedErrors lists up to 3 errors with layer + section + evidence", () => {
    const summary = summariseComposedErrors([
      {
        section: "executiveSummary",
        rule: "forbidden_phrase",
        message: "x",
        evidenceText: "irrefutable",
        layer: "thesis",
      },
      {
        section: "fulfillmentArgument",
        rule: "forbidden_phrase",
        message: "x",
        evidenceText: "delivered",
        layer: "fallback",
      },
    ]);
    expect(summary).toContain("composed:thesis executiveSummary");
    expect(summary).toContain("composed:fallback fulfillmentArgument");
    expect(summary).toContain("2 composed validation errors");
  });

  it("runPhraseAndGuardChecks is the shared kernel used by both validators", () => {
    const errors = runPhraseAndGuardChecks({
      text: "The transaction was 3-D Secure authenticated.",
      sectionKey: "paymentAuthenticationArgument",
      approvedFacts: [], // no threeDS fact → guard fails
      packageMode: "full",
      layer: "thesis",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].layer).toBe("thesis");
    expect(errors[0].rule).toBe("unsupported_claim");
  });
});

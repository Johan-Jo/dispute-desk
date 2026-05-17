import { describe, it, expect } from "vitest";
import { composePdfBlocks } from "../composePdfBlocks";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSectionKey,
} from "../../types";

function emptySection(): { text: string; usedFactIds: string[] } {
  return { text: "", usedFactIds: [] };
}

function narrative(
  override: Partial<Record<NarrativeSectionKey, { text: string; usedFactIds: string[] }>> = {},
): DefenceNarrativeOutput {
  const SECTION_KEYS: NarrativeSectionKey[] = [
    "executiveSummary",
    "transactionOverviewArgument",
    "chronologyArgument",
    "paymentAuthenticationArgument",
    "fulfillmentArgument",
    "communicationArgument",
    "policyArgument",
    "manualEvidenceArgument",
    "conclusion",
  ];
  const sections = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, override[k] ?? emptySection()]),
  ) as Record<NarrativeSectionKey, { text: string; usedFactIds: string[] }>;
  const omittedSections = SECTION_KEYS.filter((k) => !sections[k].text).map((k) => ({
    sectionKey: k,
    reason: "test_empty",
  }));
  return { ...sections, omittedSections, warnings: [] };
}

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

describe("composePdfBlocks", () => {
  it("emits one block per non-empty section, in canonical order", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        executiveSummary: { text: "Exec body.", usedFactIds: ["f0"] },
        conclusion: { text: "Concl body.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      fulfillmentStatus: null,
    });
    expect(blocks.map((b) => b.sectionKey)).toEqual([
      "executiveSummary",
      "conclusion",
    ]);
  });

  it("attaches a fact-templated thesis when the family+section template resolves", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        executiveSummary: { text: "Body.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      fulfillmentStatus: null,
    });
    const exec = blocks.find((b) => b.sectionKey === "executiveSummary")!;
    expect(exec.thesisText).toContain("AVS and CVV match");
  });

  it("attaches an empty thesisText when the template's required token is unresolvable", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        executiveSummary: { text: "Body.", usedFactIds: [] },
      }),
      // No payment_authentication fact at all.
      approvedFacts: [
        fact({ category: "order_record", value: { fulfillmentStatus: "FULFILLED" } }),
      ],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      fulfillmentStatus: "FULFILLED",
    });
    const exec = blocks.find((b) => b.sectionKey === "executiveSummary")!;
    expect(exec.thesisText).toBe("");
    expect(exec.llmText).toBe("Body.");
  });

  it("emits a fulfillment fallback block when FULFILLED + LLM omitted the section", () => {
    const blocks = composePdfBlocks({
      narrative: narrative(),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      fulfillmentStatus: "FULFILLED",
    });
    const fulfilment = blocks.find((b) => b.sectionKey === "fulfillmentArgument")!;
    expect(fulfilment).toBeDefined();
    expect(fulfilment.fallbackText).toContain("fulfilled");
    expect(fulfilment.llmText).toBe("");
  });

  it("does NOT emit a fulfillment fallback when fulfillmentStatus is not FULFILLED", () => {
    const blocks = composePdfBlocks({
      narrative: narrative(),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      fulfillmentStatus: "UNFULFILLED",
    });
    expect(blocks.find((b) => b.sectionKey === "fulfillmentArgument")).toBeUndefined();
  });

  it("preserves usedFactIds from the narrative section", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        executiveSummary: { text: "Body.", usedFactIds: ["f0", "f1"] },
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      fulfillmentStatus: null,
    });
    const exec = blocks.find((b) => b.sectionKey === "executiveSummary")!;
    expect(exec.usedFactIds).toEqual(["f0", "f1"]);
  });
});

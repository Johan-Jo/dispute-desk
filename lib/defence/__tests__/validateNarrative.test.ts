import { describe, it, expect } from "vitest";
import { validateNarrative } from "../validateNarrative";
import { resolveReasonCodeModule } from "../reasonCodes/registry";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSection,
  NarrativeSectionKey,
  ValidationError,
} from "../types";

function emptySection(): NarrativeSection {
  return { text: "", usedFactIds: [] };
}

function narrative(overrides: Partial<Record<NarrativeSectionKey, NarrativeSection>> = {}): DefenceNarrativeOutput {
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
    SECTION_KEYS.map((k) => [k, overrides[k] ?? emptySection()]),
  ) as Record<NarrativeSectionKey, NarrativeSection>;

  // Add omittedSections for every empty section so we don't trip
  // omitted_section_inconsistent in tests that aren't about that rule.
  const omittedSections = SECTION_KEYS.filter((k) => !sections[k].text)
    .map((sectionKey) => ({ sectionKey, reason: "test_empty" }));

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

const reasonCodeModule = resolveReasonCodeModule("10.4");

describe("validateNarrative", () => {
  it("passes on a clean narrative", () => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: {
          text: "The available records support that the transaction was authorised.",
          usedFactIds: ["f0"],
        },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([
    "definitive proof",
    "this is irrefutable",
    "undeniable evidence",
    "provably authentic",
    "the fraudulent cardholder",
    "the customer is lying",
  ])("rejects forbidden phrase %s", (text) => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: { text, usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: ValidationError) => e.rule === "forbidden_phrase")).toBe(true);
  });

  it("rejects narrow-mode aggressive conclusions", () => {
    const result = validateNarrative({
      narrative: narrative({
        conclusion: { text: "The dispute is invalid based on the records.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "narrow",
    });
    expect(
      result.errors.some((e) => e.rule === "narrow_mode_aggressive_conclusion"),
    ).toBe(true);
  });

  it("rejects unknown fact ids in usedFactIds", () => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: {
          text: "Some text.",
          usedFactIds: ["f99"],
        },
      }),
      approvedFacts: [fact({ id: "f0" })],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unknown_fact_id")).toBe(true);
  });

  it("rejects citation of internal-only fact ids", () => {
    const result = validateNarrative({
      narrative: narrative({
        executiveSummary: { text: "Some text.", usedFactIds: ["ip0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
      internalOnlyFactIds: ["ip0"],
    });
    expect(
      result.errors.some((e) => e.rule === "internal_only_fact_referenced"),
    ).toBe(true);
  });

  it("rejects unsupported delivery claim via claim guards", () => {
    const result = validateNarrative({
      narrative: narrative({
        fulfillmentArgument: { text: "The package was delivered to the customer.", usedFactIds: ["f0"] },
      }),
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(result.errors.some((e) => e.rule === "unsupported_claim")).toBe(true);
  });

  it("rejects an empty section that's not in omittedSections", () => {
    const result = validateNarrative({
      narrative: {
        executiveSummary: { text: "", usedFactIds: [] },
        transactionOverviewArgument: { text: "Text.", usedFactIds: ["f0"] },
        chronologyArgument: { text: "Text.", usedFactIds: ["f0"] },
        paymentAuthenticationArgument: { text: "Text.", usedFactIds: ["f0"] },
        fulfillmentArgument: { text: "Text.", usedFactIds: ["f0"] },
        communicationArgument: { text: "Text.", usedFactIds: ["f0"] },
        policyArgument: { text: "Text.", usedFactIds: ["f0"] },
        manualEvidenceArgument: { text: "Text.", usedFactIds: ["f0"] },
        conclusion: { text: "Text.", usedFactIds: ["f0"] },
        omittedSections: [],
        warnings: [],
      },
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(
      result.errors.some((e) => e.rule === "omitted_section_inconsistent"),
    ).toBe(true);
  });

  it("rejects a non-empty section that IS in omittedSections", () => {
    const result = validateNarrative({
      narrative: {
        executiveSummary: { text: "Should not be here.", usedFactIds: ["f0"] },
        transactionOverviewArgument: { text: "Text.", usedFactIds: ["f0"] },
        chronologyArgument: { text: "Text.", usedFactIds: ["f0"] },
        paymentAuthenticationArgument: { text: "Text.", usedFactIds: ["f0"] },
        fulfillmentArgument: { text: "Text.", usedFactIds: ["f0"] },
        communicationArgument: { text: "Text.", usedFactIds: ["f0"] },
        policyArgument: { text: "Text.", usedFactIds: ["f0"] },
        manualEvidenceArgument: { text: "Text.", usedFactIds: ["f0"] },
        conclusion: { text: "Text.", usedFactIds: ["f0"] },
        omittedSections: [{ sectionKey: "executiveSummary", reason: "test" }],
        warnings: [],
      },
      approvedFacts: [fact()],
      reasonCodeModule,
      packageMode: "full",
    });
    expect(
      result.errors.some((e) => e.rule === "omitted_section_inconsistent"),
    ).toBe(true);
  });
});

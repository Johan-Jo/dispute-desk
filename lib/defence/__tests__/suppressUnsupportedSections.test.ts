/**
 * Suppression tests.
 *
 * Three properties carry this module: an unsupported argument section is
 * removed, a summary section never is, and the letter is never emptied. The
 * last two are the guards that keep this from being worse than the defect.
 */

import { describe, expect, it } from "vitest";
import {
  SUPPRESSION_REASON,
  suppressUnsupportedSections,
} from "../suppressUnsupportedSections";
import { validateNarrative } from "../validateNarrative";
import type { DefenceNarrativeOutput, EvidenceFact, NarrativeSectionKey } from "../types";

function fact(id: string, citable: boolean): EvidenceFact {
  return {
    id,
    category: "payment_authentication",
    label: id,
    value: {},
    source: "shopify_order",
    sourceRef: null,
    strength: "moderate",
    bankEligible: citable,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: citable,
    submissionRisk: false,
  } as EvidenceFact;
}

const EMPTY = { text: "", usedFactIds: [] as string[] };

function narrative(
  sections: Partial<Record<NarrativeSectionKey, { text: string; usedFactIds: string[] }>>,
): DefenceNarrativeOutput {
  return {
    executiveSummary: { ...EMPTY },
    transactionOverviewArgument: { ...EMPTY },
    chronologyArgument: { ...EMPTY },
    paymentAuthenticationArgument: { ...EMPTY },
    fulfillmentArgument: { ...EMPTY },
    communicationArgument: { ...EMPTY },
    policyArgument: { ...EMPTY },
    manualEvidenceArgument: { ...EMPTY },
    conclusion: { ...EMPTY },
    omittedSections: [],
    warnings: [],
    ...sections,
  } as DefenceNarrativeOutput;
}

describe("an argument resting only on withheld facts is dropped", () => {
  it("removes the section and records why", () => {
    const result = suppressUnsupportedSections({
      narrative: narrative({
        paymentAuthenticationArgument: { text: "The card was verified.", usedFactIds: ["f-bad"] },
        fulfillmentArgument: { text: "It was delivered.", usedFactIds: ["f-good"] },
      }),
      approvedFacts: [fact("f-bad", false), fact("f-good", true)],
    });

    expect(result.suppressed).toEqual(["paymentAuthenticationArgument"]);
    expect(result.narrative.paymentAuthenticationArgument.text).toBe("");
    expect(result.narrative.paymentAuthenticationArgument.usedFactIds).toEqual([]);
    expect(result.narrative.omittedSections).toContainEqual({
      sectionKey: "paymentAuthenticationArgument",
      reason: SUPPRESSION_REASON,
    });
    // The supported section is untouched.
    expect(result.narrative.fulfillmentArgument.text).toBe("It was delivered.");
  });

  it("keeps a section with even one citable fact", () => {
    const result = suppressUnsupportedSections({
      narrative: narrative({
        paymentAuthenticationArgument: {
          text: "Verified.",
          usedFactIds: ["f-bad", "f-good"],
        },
      }),
      approvedFacts: [fact("f-bad", false), fact("f-good", true)],
    });
    expect(result.suppressed).toEqual([]);
  });

  it("treats an internal-only fact as non-citable", () => {
    const result = suppressUnsupportedSections({
      narrative: narrative({
        policyArgument: { text: "Policy was shown.", usedFactIds: ["f-int"] },
        fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
      }),
      approvedFacts: [fact("f-int", true), fact("f-good", true)],
      internalOnlyFactIds: ["f-int"],
    });
    expect(result.suppressed).toEqual(["policyArgument"]);
  });

  it("ignores a section that cites nothing at all", () => {
    // That is a different defect and not this module's to judge.
    const result = suppressUnsupportedSections({
      narrative: narrative({
        policyArgument: { text: "Boilerplate.", usedFactIds: [] },
        fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
      }),
      approvedFacts: [fact("f-good", true)],
    });
    expect(result.suppressed).toEqual([]);
  });
});

describe("the guards", () => {
  it("never suppresses the executive summary or the conclusion", () => {
    // A letter with no opening and no closing reads as truncated — worse than
    // a summary leaning on a fact listed further down.
    const result = suppressUnsupportedSections({
      narrative: narrative({
        executiveSummary: { text: "In summary.", usedFactIds: ["f-bad"] },
        conclusion: { text: "Therefore.", usedFactIds: ["f-bad"] },
        fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
      }),
      approvedFacts: [fact("f-bad", false), fact("f-good", true)],
    });
    expect(result.suppressed).toEqual([]);
    expect(result.narrative.executiveSummary.text).toBe("In summary.");
    expect(result.narrative.conclusion.text).toBe("Therefore.");
  });

  it("declines rather than emptying the letter", () => {
    // Filing boilerplate with every argument removed is the "filed nothing"
    // outcome wearing a PDF.
    const result = suppressUnsupportedSections({
      narrative: narrative({
        transactionOverviewArgument: { text: "Overview.", usedFactIds: ["f-bad"] },
        paymentAuthenticationArgument: { text: "Verified.", usedFactIds: ["f-bad"] },
      }),
      approvedFacts: [fact("f-bad", false)],
    });
    expect(result.declinedToEmptyLetter).toBe(true);
    expect(result.suppressed).toEqual([]);
    expect(result.narrative.transactionOverviewArgument.text).toBe("Overview.");
  });

  it("suppresses when at least one argument survives", () => {
    const result = suppressUnsupportedSections({
      narrative: narrative({
        transactionOverviewArgument: { text: "Overview.", usedFactIds: ["f-bad"] },
        paymentAuthenticationArgument: { text: "Verified.", usedFactIds: ["f-bad"] },
        fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
      }),
      approvedFacts: [fact("f-bad", false), fact("f-good", true)],
    });
    expect(result.declinedToEmptyLetter).toBe(false);
    expect(result.suppressed).toEqual([
      "transactionOverviewArgument",
      "paymentAuthenticationArgument",
    ]);
  });

  it("does not duplicate a section already listed as omitted", () => {
    const base = narrative({
      policyArgument: { text: "Policy.", usedFactIds: ["f-bad"] },
      fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
    });
    base.omittedSections = [{ sectionKey: "policyArgument", reason: "earlier reason" }];
    const result = suppressUnsupportedSections({
      narrative: base,
      approvedFacts: [fact("f-bad", false), fact("f-good", true)],
    });
    const entries = result.narrative.omittedSections.filter(
      (o) => o.sectionKey === "policyArgument",
    );
    expect(entries).toHaveLength(1);
  });

  it("leaves the input narrative unmutated", () => {
    const input = narrative({
      paymentAuthenticationArgument: { text: "Verified.", usedFactIds: ["f-bad"] },
      fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
    });
    suppressUnsupportedSections({
      narrative: input,
      approvedFacts: [fact("f-bad", false), fact("f-good", true)],
    });
    expect(input.paymentAuthenticationArgument.text).toBe("Verified.");
    expect(input.omittedSections).toEqual([]);
  });
});

describe("the validator has nothing left to report", () => {
  it("clears the citability warning it was built to answer", () => {
    // The whole point: run suppression first and rule 5 finds nothing, while
    // rule 4 (omission consistency) stays satisfied.
    const approvedFacts = [fact("f-bad", false), fact("f-good", true)];
    const raw = narrative({
      executiveSummary: { text: "Summary.", usedFactIds: ["f-good"] },
      paymentAuthenticationArgument: { text: "Verified.", usedFactIds: ["f-bad"] },
      fulfillmentArgument: { text: "Delivered.", usedFactIds: ["f-good"] },
      conclusion: { text: "Therefore.", usedFactIds: ["f-good"] },
    });
    // Rule 4 requires EVERY empty section to be declared omitted, so a
    // realistic narrative already lists the ones this case does not write.
    raw.omittedSections = (
      [
        "transactionOverviewArgument",
        "chronologyArgument",
        "communicationArgument",
        "policyArgument",
        "manualEvidenceArgument",
      ] as NarrativeSectionKey[]
    ).map((sectionKey) => ({ sectionKey, reason: "no facts of this kind" }));

    const before = validateNarrative({
      narrative: raw,
      approvedFacts,
      reasonCodeModule: { prohibitedBankPhrases: [] } as never,
      packageMode: "standard" as never,
    });
    expect(
      (before.warnings ?? []).some((w) => w.rule === "section_support_not_bank_citable"),
    ).toBe(true);

    const { narrative: cleaned } = suppressUnsupportedSections({ narrative: raw, approvedFacts });
    const after = validateNarrative({
      narrative: cleaned,
      approvedFacts,
      reasonCodeModule: { prohibitedBankPhrases: [] } as never,
      packageMode: "standard" as never,
    });

    expect(
      (after.warnings ?? []).some((w) => w.rule === "section_support_not_bank_citable"),
    ).toBe(false);
    expect(after.errors.some((e) => e.rule === "omitted_section_inconsistent")).toBe(false);
  });
});

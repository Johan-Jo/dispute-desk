/**
 * The package is a PROJECTION of the plan — CP-B §2.
 *
 * The load-bearing acceptance criterion, stated as a test: a fixture carrying
 * approved AND `review_required` facts produces a package with only approved
 * support and NO ORPHANED CLAIM. "No orphaned claim" is checked structurally —
 * no surviving block may cite an excluded record — not by grepping prose.
 */

import { describe, expect, it } from "vitest";
import {
  FIXTURE_REVIEW_REQUIRED_NO_SAFE,
  FIXTURE_REVIEW_REQUIRED_SAFE,
  FIXTURE_STRONG,
} from "@/lib/pipeline/contracts/__fixtures__/cases";
import type { CaseArgumentPlanSnapshot } from "@/lib/pipeline/contracts";
import {
  SUPPORT_EXCLUDED_REASON,
  projectPackageFromPlan,
  rebuildNarrativeFromPlan,
  selectPlanFacts,
} from "..";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSectionKey,
} from "../../types";

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

function narrative(
  sections: Partial<Record<NarrativeSectionKey, { text: string; usedFactIds: string[] }>> = {},
): DefenceNarrativeOutput {
  const out = {} as DefenceNarrativeOutput;
  for (const key of SECTION_KEYS) {
    out[key] = sections[key] ?? { text: "", usedFactIds: [] };
  }
  out.omittedSections = SECTION_KEYS.filter((k) => !sections[k]).map((sectionKey) => ({
    sectionKey,
    reason: "no_content",
  }));
  out.warnings = [];
  return out;
}

function fact(over: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "f0",
    category: "delivery_proof",
    label: "Delivery confirmation",
    value: { fieldKey: "delivery_proof", proofType: "delivered_confirmed", carrier: "PostNord" },
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

/** The two records the review_required fixture names, as real facts. */
const DELIVERY_RECORD = "review_required_safe#delivery";
const TDS_RECORD = "review_required_safe#tds";

function factsFor(plan: CaseArgumentPlanSnapshot): Map<string, EvidenceFact> {
  const map = new Map<string, EvidenceFact>();
  for (const included of plan.included) {
    map.set(included.recordId, fact({ id: included.recordId }));
  }
  for (const excluded of plan.excluded) {
    map.set(
      excluded.recordId,
      fact({
        id: excluded.recordId,
        category: "payment_authentication",
        label: "3-D Secure authentication",
        value: { fieldKey: "tds_authentication", threeDS: true },
      }),
    );
  }
  return map;
}

function project(plan: CaseArgumentPlanSnapshot, output: DefenceNarrativeOutput) {
  return projectPackageFromPlan({
    plan,
    narrative: output,
    factsByRecordId: factsFor(plan),
    packageMode: "full",
    familyKey: "unauthorized_fraud",
    moduleKey: "visa_10_4_fraud",
    fulfillmentStatus: "FULFILLED",
  });
}

describe("selectPlanFacts", () => {
  it("returns exactly the plan's included records, never the excluded ones", () => {
    const plan = FIXTURE_REVIEW_REQUIRED_SAFE.plan;
    const selection = selectPlanFacts(plan, factsFor(plan));
    expect(selection.includedFacts.map((f) => f.id)).toEqual([DELIVERY_RECORD]);
    expect(selection.excludedIds).toEqual(new Set([TDS_RECORD]));
    expect(selection.missingRecordIds).toEqual([]);
  });

  it("REPORTS a plan-authorised record with no fact rather than skipping it", () => {
    const plan = FIXTURE_STRONG.plan;
    const selection = selectPlanFacts(plan, new Map());
    expect(selection.includedFacts).toEqual([]);
    expect(selection.missingRecordIds).toEqual(plan.included.map((i) => i.recordId));
  });
});

describe("rebuildNarrativeFromPlan — no sentence survives its support", () => {
  it("drops a section that cites an excluded record and records the orphan", () => {
    const plan = FIXTURE_REVIEW_REQUIRED_SAFE.plan;
    const rebuilt = rebuildNarrativeFromPlan({
      plan,
      narrative: narrative({
        fulfillmentArgument: { text: "The carrier confirmed delivery.", usedFactIds: [DELIVERY_RECORD] },
        paymentAuthenticationArgument: {
          text: "The cardholder authenticated through 3-D Secure.",
          usedFactIds: [TDS_RECORD],
        },
      }),
    });

    expect(rebuilt.narrative.paymentAuthenticationArgument).toEqual({ text: "", usedFactIds: [] });
    expect(rebuilt.narrative.fulfillmentArgument.text).toBe("The carrier confirmed delivery.");
    expect(rebuilt.orphaned).toEqual([
      { sectionKey: "paymentAuthenticationArgument", unsupportedFactIds: [TDS_RECORD] },
    ]);
    expect(
      rebuilt.narrative.omittedSections.some(
        (o) => o.sectionKey === "paymentAuthenticationArgument" && o.reason === SUPPORT_EXCLUDED_REASON,
      ),
    ).toBe(true);
  });

  it("drops the WHOLE section, not the offending clause", () => {
    const plan = FIXTURE_REVIEW_REQUIRED_SAFE.plan;
    const rebuilt = rebuildNarrativeFromPlan({
      plan,
      narrative: narrative({
        executiveSummary: {
          // One section, two claims, one of them unsupported. Sub-sentence
          // surgery would leave the supported half plus an orphaned topic
          // sentence; the whole block goes instead.
          text: "Delivery was confirmed by the carrier, and the cardholder authenticated via 3-D Secure.",
          usedFactIds: [DELIVERY_RECORD, TDS_RECORD],
        },
      }),
    });
    expect(rebuilt.narrative.executiveSummary.text).toBe("");
  });

  it("drops a section citing an id the plan never authorised (positional f-ids)", () => {
    const plan = FIXTURE_STRONG.plan;
    const rebuilt = rebuildNarrativeFromPlan({
      plan,
      narrative: narrative({ conclusion: { text: "We ask the issuer to reverse.", usedFactIds: ["f0"] } }),
    });
    expect(rebuilt.narrative.conclusion.text).toBe("");
    expect(rebuilt.orphaned[0]?.unsupportedFactIds).toEqual(["f0"]);
  });

  it("is idempotent — rebuilding an already-rebuilt narrative changes nothing", () => {
    const plan = FIXTURE_REVIEW_REQUIRED_SAFE.plan;
    const once = rebuildNarrativeFromPlan({
      plan,
      narrative: narrative({
        paymentAuthenticationArgument: { text: "3-D Secure.", usedFactIds: [TDS_RECORD] },
      }),
    });
    const twice = rebuildNarrativeFromPlan({ plan, narrative: once.narrative });
    expect(twice.narrative).toEqual(once.narrative);
    expect(twice.orphaned).toEqual([]);
  });
});

describe("projectPackageFromPlan — the acceptance fixture", () => {
  const plan = FIXTURE_REVIEW_REQUIRED_SAFE.plan;
  const output = narrative({
    fulfillmentArgument: {
      text: "The carrier recorded delivery on 12 May 2026 (PostNord).",
      usedFactIds: [DELIVERY_RECORD],
    },
    paymentAuthenticationArgument: {
      text: "The cardholder authenticated the transaction through 3-D Secure.",
      usedFactIds: [TDS_RECORD],
    },
    conclusion: { text: "We respectfully ask the issuer to reverse the chargeback.", usedFactIds: [] },
  });

  it("contains ONLY approved support", () => {
    const projection = project(plan, output);
    expect(projection.includedFacts.map((f) => f.id)).toEqual([DELIVERY_RECORD]);
    expect(projection.excludedRecordIds).toEqual([TDS_RECORD]);
    for (const block of projection.blocks) {
      for (const id of block.usedFactIds) {
        expect(projection.excludedRecordIds).not.toContain(id);
      }
    }
  });

  it("has NO ORPHANED CLAIM in the rendered blocks", () => {
    const projection = project(plan, output);
    const rendered = projection.blocks.map((b) => b.sectionKey);
    expect(rendered).not.toContain("paymentAuthenticationArgument");
    // The claim that lost its support is recorded, not merely gone.
    expect(projection.orphaned).toEqual([
      { sectionKey: "paymentAuthenticationArgument", unsupportedFactIds: [TDS_RECORD] },
    ]);
  });

  it("keeps the supported argument intact", () => {
    const projection = project(plan, output);
    const fulfilment = projection.blocks.find((b) => b.sectionKey === "fulfillmentArgument");
    expect(fulfilment?.llmText).toContain("PostNord");
  });

  it("never hands the excluded fact to any downstream surface", () => {
    const projection = project(plan, output);
    const serialised = JSON.stringify(projection.blocks) + JSON.stringify(projection.includedFacts);
    expect(serialised).not.toContain(TDS_RECORD);
    expect(serialised).not.toContain("3-D Secure");
  });

  it("a plan with no safe argument projects no supporting facts at all", () => {
    const noSafe = FIXTURE_REVIEW_REQUIRED_NO_SAFE.plan;
    const projection = projectPackageFromPlan({
      plan: noSafe,
      narrative: narrative({
        fulfillmentArgument: {
          text: "The carrier confirmed delivery.",
          usedFactIds: ["review_required_no_safe#delivery"],
        },
      }),
      factsByRecordId: factsFor(noSafe),
      packageMode: "narrow",
      familyKey: "unauthorized_fraud",
      moduleKey: "visa_10_4_fraud",
      fulfillmentStatus: null,
    });
    expect(projection.includedFacts).toEqual([]);
    expect(projection.blocks.every((b) => b.llmText === "")).toBe(true);
  });

  it("is deterministic — the same inputs project identically", () => {
    expect(project(plan, output)).toEqual(project(plan, output));
  });
});

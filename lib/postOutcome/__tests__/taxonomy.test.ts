/**
 * Taxonomy tests (plan §8, §9). The vocabularies are closed on purpose — these
 * pin that the closure is real and that the causal-language guard catches the
 * phrasings the plan forbids.
 */

import { describe, expect, it } from "vitest";
import {
  findCausalLanguageViolations,
  isFindingCategory,
  isProviderAccessLevel,
  REVIEW_STATES,
  WIN_ONLY_CATEGORIES,
  EVIDENCE_EFFECTIVENESS_LEVELS,
  isSubmissionConfirmationSource,
} from "../taxonomy";

describe("closed vocabularies", () => {
  it("rejects values outside the taxonomy", () => {
    expect(isFindingCategory("AVAILABLE_EVIDENCE_OMITTED")).toBe(true);
    expect(isFindingCategory("BANK_DIDNT_LIKE_IT")).toBe(false);
    expect(isProviderAccessLevel("PARTIAL_CASE_FILE")).toBe(true);
    expect(isProviderAccessLevel("MOSTLY")).toBe(false);
  });

  it("keeps PLATFORM_SAVE_ONLY a first-class source, not an absence", () => {
    // "Saved and verified, never forwarded" is a positive fact about the case.
    expect(isSubmissionConfirmationSource("PLATFORM_SAVE_ONLY")).toBe(true);
    expect(isSubmissionConfirmationSource("NONE")).toBe(true);
  });

  it("includes PENDING_REVIEW in review states but not in dispositions", () => {
    expect(REVIEW_STATES).toContain("PENDING_REVIEW");
    expect(REVIEW_STATES).toContain("CONFIRMED");
  });

  it("gates win-only categories and evidence-effectiveness levels", () => {
    expect(WIN_ONLY_CATEGORIES.has("EFFECTIVE_CONFIGURATION_CANDIDATE")).toBe(true);
    expect(WIN_ONLY_CATEGORIES.has("MISSING_ACQUIRABLE_EVIDENCE")).toBe(false);
    // Only FULL_POST_OUTCOME may support an evidence-effectiveness claim — the
    // reason the single prod win produces no candidate.
    expect(EVIDENCE_EFFECTIVENESS_LEVELS.has("FULL_POST_OUTCOME")).toBe(true);
    expect(EVIDENCE_EFFECTIVENESS_LEVELS.has("PACKAGE_INTEGRITY_ONLY")).toBe(false);
  });
});

describe("causal-language guard", () => {
  it("catches an invented bank rationale", () => {
    expect(
      findCausalLanguageViolations(
        "The bank rejected this because the address did not match.",
      ),
    ).not.toHaveLength(0);
  });

  it("catches counterfactual win claims", () => {
    expect(
      findCausalLanguageViolations("With delivery proof we would have won."),
    ).not.toHaveLength(0);
    expect(
      findCausalLanguageViolations("This lost because the pack was thin."),
    ).not.toHaveLength(0);
    expect(
      findCausalLanguageViolations("Expected win-rate lift of 4 points."),
    ).not.toHaveLength(0);
  });

  it("permits the observational phrasing the plan prescribes", () => {
    const permitted = [
      "Observed gap: approved evidence available before submission was absent from the package.",
      "No material gap identified from retained records.",
      "Evidence configuration associated with won cases in this comparable cohort.",
      "Potential improvement: capture carrier proof before the deadline.",
    ];
    for (const text of permitted) {
      expect(findCausalLanguageViolations(text)).toEqual([]);
    }
  });
});

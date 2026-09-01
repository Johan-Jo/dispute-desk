/**
 * Conclusion-derivation tests.
 *
 * The load-bearing property is the last describe block: this module states what
 * we filed and must never state why an issuer ruled. A conclusion that drifts
 * into causal language is the failure the whole feature exists to prevent.
 */

import { describe, expect, it } from "vitest";
import {
  deriveConclusions,
  dominantCategory,
  parseSections,
  type ConclusionAnalysis,
  type ConclusionFinding,
} from "../conclusions";
import { FORBIDDEN_CAUSAL_PATTERNS } from "../taxonomy";

function analysis(overrides: Partial<ConclusionAnalysis> = {}): ConclusionAnalysis {
  return {
    outcome: "lost",
    effectiveCategory: "UNSUPPORTED_OR_OVERSTATED_ASSERTION",
    analysisLevel: "FULL_POST_OUTCOME",
    submissionConfirmationSource: "SHOPIFY_EVIDENCE_SENT_ON",
    reviewState: "CONFIRMED",
    ...overrides,
  };
}

function finding(observedFact: string, id = "a-1"): ConclusionFinding {
  return {
    analysisId: id,
    category: "UNSUPPORTED_OR_OVERSTATED_ASSERTION",
    observedFact,
  };
}

describe("parsing section names out of an observed fact", () => {
  it("finds every section in a multi-section string", () => {
    expect(
      parseSections(
        "section:transactionOverviewArgument: 2 supporting fact(s), none of them issuer-facing. section:paymentAuthenticationArgument: 2 supporting fact(s), none of them issuer-facing.",
      ),
    ).toEqual(["transactionOverviewArgument", "paymentAuthenticationArgument"]);
  });

  it("returns nothing for text with no sections", () => {
    expect(parseSections("Evidence was saved but never forwarded")).toEqual([]);
    expect(parseSections(null)).toEqual([]);
  });
});

describe("the concentration conclusion", () => {
  it("names the template carrying most of the defect", () => {
    const findings = [
      ...Array.from({ length: 24 }, (_, i) => finding("section:paymentAuthenticationArgument: x", `a-${i}`)),
      ...Array.from({ length: 6 }, (_, i) => finding("section:transactionOverviewArgument: x", `b-${i}`)),
    ];
    const [c] = deriveConclusions([analysis()], findings);
    expect(c.key).toBe("section_concentration");
    expect(c.headline).toContain("payment authentication argument");
    expect(c.headline).toContain("80%");
    expect(c.action).toContain("24 of 30");
    expect(c.strength).toBe("OBSERVED");
  });

  it("says so plainly when there is only one template", () => {
    const [c] = deriveConclusions([analysis()], [finding("section:conclusion: x")]);
    expect(c.headline).toMatch(/Every unsupported section is the same template/);
  });
});

describe("comparing clean against defective packages", () => {
  it("refuses the comparison on a small arm and says why", () => {
    // Two clean packages is exactly the real prod shape, and the honest answer
    // there is "cannot tell", not a percentage.
    const rows = [
      ...Array.from({ length: 2 }, () =>
        analysis({ effectiveCategory: "NO_MATERIAL_GAP_OBSERVED" }),
      ),
      ...Array.from({ length: 40 }, () => analysis()),
    ];
    const c = deriveConclusions(rows, []).find((x) => x.key === "quality_vs_outcome");
    expect(c?.strength).toBe("INSUFFICIENT");
    expect(c?.headline).toMatch(/cannot be tested/);
    expect(c?.action).toMatch(/correctness fix/);
  });

  it("reports no difference when both arms are big enough and equal", () => {
    const rows = [
      ...Array.from({ length: 10 }, () =>
        analysis({ effectiveCategory: "NO_MATERIAL_GAP_OBSERVED", outcome: "lost" }),
      ),
      ...Array.from({ length: 10 }, () => analysis({ outcome: "lost" })),
    ];
    const c = deriveConclusions(rows, []).find((x) => x.key === "quality_vs_outcome");
    expect(c?.strength).toBe("DIRECTIONAL");
    expect(c?.headline).toMatch(/did not fare differently/);
  });

  it("never calls a comparison OBSERVED", () => {
    // OBSERVED is reserved for counts of our own artefacts. A win-rate
    // comparison is an inference and may never claim that status.
    const rows = [
      ...Array.from({ length: 10 }, () =>
        analysis({ effectiveCategory: "NO_MATERIAL_GAP_OBSERVED", outcome: "won" }),
      ),
      ...Array.from({ length: 10 }, () => analysis({ outcome: "lost" })),
    ];
    const c = deriveConclusions(rows, []).find((x) => x.key === "quality_vs_outcome");
    expect(c?.strength).not.toBe("OBSERVED");
  });
});

describe("reliability and review state", () => {
  it("counts packages that were never confirmed forwarded", () => {
    const rows = [
      analysis({ submissionConfirmationSource: "PLATFORM_SAVE_ONLY" }),
      analysis({ submissionConfirmationSource: "NONE" }),
      analysis(),
    ];
    const c = deriveConclusions(rows, []).find((x) => x.key === "never_forwarded");
    expect(c?.headline).toMatch(/^2 packages were saved but never confirmed forwarded/);
    expect(c?.strength).toBe("OBSERVED");
  });

  it("omits the forwarding conclusion when everything forwarded", () => {
    const c = deriveConclusions([analysis()], []).find((x) => x.key === "never_forwarded");
    expect(c).toBeUndefined();
  });

  it("says how much is still only a hypothesis", () => {
    const rows = [analysis({ reviewState: "PENDING_REVIEW" }), analysis()];
    const c = deriveConclusions(rows, []).find((x) => x.key === "unreviewed");
    expect(c?.headline).toMatch(/1 of 2 analyses are unreviewed/);
  });

  it("returns nothing at all for an empty set", () => {
    expect(deriveConclusions([], [])).toEqual([]);
  });
});

describe("the dominant category", () => {
  it("ignores clean packages when naming the dominant problem", () => {
    const rows = [
      ...Array.from({ length: 5 }, () =>
        analysis({ effectiveCategory: "NO_MATERIAL_GAP_OBSERVED" }),
      ),
      ...Array.from({ length: 3 }, () => analysis()),
    ];
    const d = dominantCategory(rows);
    expect(d?.category).toBe("UNSUPPORTED_OR_OVERSTATED_ASSERTION");
    expect(d?.label).toBe("Argued without citing");
    expect(d?.count).toBe(3);
  });

  it("is null when nothing has a category", () => {
    expect(dominantCategory([])).toBeNull();
    expect(
      dominantCategory([analysis({ effectiveCategory: "NO_MATERIAL_GAP_OBSERVED" })]),
    ).toBeNull();
  });
});

describe("conclusions describe what we filed, never why we lost", () => {
  it("emits no causal language on a realistic corpus", () => {
    const rows = [
      ...Array.from({ length: 26 }, (_, i) => analysis()),
      ...Array.from({ length: 2 }, () =>
        analysis({ effectiveCategory: "NO_MATERIAL_GAP_OBSERVED" }),
      ),
      analysis({
        effectiveCategory: "PROCEDURAL_OR_SUBMISSION_FAILURE",
        submissionConfirmationSource: "PLATFORM_SAVE_ONLY",
        reviewState: "PENDING_REVIEW",
      }),
    ];
    const findings = [
      ...Array.from({ length: 24 }, (_, i) =>
        finding("section:paymentAuthenticationArgument: x", `u-${i}`),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        finding("section:transactionOverviewArgument: x", `u-${i}`),
      ),
    ];

    const text = deriveConclusions(rows, findings)
      .flatMap((c) => [c.headline, c.detail, c.action ?? ""])
      .join(" ");

    for (const pattern of FORBIDDEN_CAUSAL_PATTERNS) {
      expect(text).not.toMatch(pattern);
    }
  });
});

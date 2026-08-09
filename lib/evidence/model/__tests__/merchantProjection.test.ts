/**
 * CP-A — the merchant projection, and `needsRecalculation` as a state.
 *
 * THE FAILURE THIS PREVENTS: a merchant opens a dispute, reads "Strong · 92%
 * complete", and closes the tab — for a snapshot computed against evidence
 * they replaced an hour ago. A stale number rendered as current is worse than
 * no number, because it is acted on.
 *
 * So the assertions are mostly about what the projection REFUSES to say. The
 * shared contract fixtures are used where they fit, because agreeing with B
 * and C about what "stale" means is the point of having them.
 */

import { describe, it, expect } from "vitest";
import {
  projectMerchantAssessment,
  projectReviewItems,
  REVIEW_REASON_FALLBACK_TOKEN,
} from "../merchantProjection";
import {
  FIXTURE_REVIEW_REQUIRED_NO_SAFE,
  FIXTURE_REVIEW_REQUIRED_SAFE,
  FIXTURE_STALE,
  FIXTURE_STRONG,
} from "@/lib/pipeline/contracts/__fixtures__/cases";
import type { CaseArgumentPlanSnapshot } from "@/lib/pipeline/contracts";

const POLICY = 1;

function currentHashOf(fixture: { assessment: { freshness: { inputHash: string } } }) {
  return fixture.assessment.freshness.inputHash;
}

describe("projectMerchantAssessment — fresh", () => {
  it("carries the band, the score and the readiness straight through", () => {
    const p = projectMerchantAssessment({
      caseId: "strong",
      snapshot: FIXTURE_STRONG.assessment,
      currentInputHash: currentHashOf(FIXTURE_STRONG),
      currentPolicyVersion: POLICY,
    });
    expect(p.needsRecalculation).toBe(false);
    expect(p.recalculationReason).toBeNull();
    expect(p.strengthBand).toBe(FIXTURE_STRONG.assessment.strength.overall);
    expect(p.completenessScore).toBe(FIXTURE_STRONG.assessment.completeness.score);
    expect(p.readiness).toBe(FIXTURE_STRONG.assessment.completeness.readiness);
  });

  it("exposes no input from which a consumer could re-band or re-derive readiness", () => {
    // The structural half of the migration. If the projection shipped the
    // checklist, a tab could recompute — and one did, for a year.
    const p = projectMerchantAssessment({
      caseId: "strong",
      snapshot: FIXTURE_STRONG.assessment,
      currentInputHash: currentHashOf(FIXTURE_STRONG),
      currentPolicyVersion: POLICY,
    });
    expect(Object.keys(p).sort()).toEqual([
      "caseId",
      "completenessScore",
      "needsRecalculation",
      "readiness",
      "recalculationReason",
      "reviewItems",
      "strengthBand",
    ]);
  });
});

describe("projectMerchantAssessment — needsRecalculation is a first-class state", () => {
  it("an ABSENT snapshot nulls every value and says why", () => {
    const p = projectMerchantAssessment({
      caseId: "never-computed",
      snapshot: null,
      currentInputHash: "whatever",
      currentPolicyVersion: POLICY,
    });
    expect(p.needsRecalculation).toBe(true);
    expect(p.recalculationReason).toBe("snapshot_absent");
    expect(p.strengthBand).toBeNull();
    expect(p.completenessScore).toBeNull();
    expect(p.readiness).toBeNull();
  });

  it("a HASH MISMATCH nulls every value and routes differently from absent", () => {
    // Absent means "never computed" (recalculate). Mismatch means "computed
    // against something that has since changed" (rebuild). They block the
    // same way and are offered to the merchant differently, so they must not
    // collapse into one boolean.
    const p = projectMerchantAssessment({
      caseId: "stale",
      snapshot: FIXTURE_STALE.assessment,
      currentInputHash: "stale-assessment",
      currentPolicyVersion: POLICY,
    });
    expect(p.needsRecalculation).toBe(true);
    expect(p.recalculationReason).toBe("input_hash_mismatch");
    expect(p.strengthBand).toBeNull();
  });

  it("a POLICY BUMP invalidates a snapshot whose inputs are byte-identical", () => {
    const p = projectMerchantAssessment({
      caseId: "strong",
      snapshot: FIXTURE_STRONG.assessment,
      currentInputHash: currentHashOf(FIXTURE_STRONG),
      currentPolicyVersion: POLICY + 1,
    });
    expect(p.needsRecalculation).toBe(true);
    expect(p.recalculationReason).toBe("policy_version_superseded");
  });

  it("a stale STRONG case never renders as Strong — the whole point", () => {
    // FIXTURE_STALE is deliberately a `strong` assessment. If staleness were
    // handled by a flag beside a surviving band, this is the case where the
    // merchant would be told the best possible news about the worst possible
    // snapshot.
    expect(FIXTURE_STALE.assessment.strength.overall).toBe("strong");
    const p = projectMerchantAssessment({
      caseId: "stale",
      snapshot: FIXTURE_STALE.assessment,
      currentInputHash: "stale-assessment",
      currentPolicyVersion: POLICY,
    });
    expect(p.strengthBand).toBeNull();
  });

  it("values go null TOGETHER — there is no partial mode", () => {
    const p = projectMerchantAssessment({
      caseId: "stale",
      snapshot: FIXTURE_STALE.assessment,
      currentInputHash: "stale-assessment",
      currentPolicyVersion: POLICY,
    });
    expect([p.strengthBand, p.completenessScore, p.readiness]).toEqual([null, null, null]);
  });
});

describe("review items", () => {
  it("projects the review_required exclusions, with the plan's own deadlineOnly verdict", () => {
    const items = projectReviewItems(FIXTURE_REVIEW_REQUIRED_SAFE.plan);
    expect(items).toEqual([
      {
        recordId: "review_required_safe#tds",
        fieldKey: "tds_authentication",
        reasonToken: "fixtures.reviewRequired.tds",
        blocksNormalFiling: true,
      },
    ]);
  });

  it("ignores exclusions that are not review_required", () => {
    // `not_argument_relevant` is an argument-scope decision, not something
    // the merchant is being asked to confirm. Surfacing it as a review item
    // would ask for an action that does not exist.
    const plan: CaseArgumentPlanSnapshot = {
      ...FIXTURE_REVIEW_REQUIRED_SAFE.plan,
      excluded: [
        {
          recordId: "x#a",
          fieldKey: "activity_log",
          reason: "not_argument_relevant",
          merchantReasonToken: null,
        },
      ],
    };
    expect(projectReviewItems(plan)).toEqual([]);
  });

  it("substitutes a generic token rather than emitting an empty reason", () => {
    const plan: CaseArgumentPlanSnapshot = {
      ...FIXTURE_REVIEW_REQUIRED_SAFE.plan,
      excluded: [
        {
          recordId: "x#a",
          fieldKey: "delivery_proof",
          reason: "review_required",
          merchantReasonToken: null,
        },
      ],
    };
    expect(projectReviewItems(plan)[0].reasonToken).toBe(REVIEW_REASON_FALLBACK_TOKEN);
  });

  it("emits no English — every reason is a token key", () => {
    for (const fixture of [FIXTURE_REVIEW_REQUIRED_SAFE, FIXTURE_REVIEW_REQUIRED_NO_SAFE]) {
      for (const item of projectReviewItems(fixture.plan)) {
        expect(item.reasonToken).toMatch(/^[a-zA-Z0-9_.]+$/);
        expect(item.reasonToken).not.toMatch(/\s/);
      }
    }
  });

  it("survives staleness — the merchant keeps their lever while the score recomputes", () => {
    // "One item needs your confirmation" is a fact about the evidence, not
    // about the score. Hiding it during a recalculation removes the only
    // action available at the exact moment the merchant is asked to wait.
    const p = projectMerchantAssessment({
      caseId: "review_required_safe",
      snapshot: null,
      currentInputHash: "x",
      currentPolicyVersion: POLICY,
      plan: FIXTURE_REVIEW_REQUIRED_SAFE.plan,
    });
    expect(p.needsRecalculation).toBe(true);
    expect(p.reviewItems).toHaveLength(1);
  });

  it("is empty when there is no plan at all", () => {
    expect(projectReviewItems(null)).toEqual([]);
    expect(projectReviewItems(undefined)).toEqual([]);
  });
});

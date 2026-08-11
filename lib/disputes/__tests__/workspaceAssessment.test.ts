/**
 * CP-A — the workspace payload PROJECTS the persisted snapshot.
 *
 * ── WHAT THIS FILE USED TO ASSERT, AND WHY IT CHANGED ─────────────────
 *
 * It asserted that `buildWorkspaceAssessment` derived readiness once and
 * applied the gates it was given. Both were true and both were the defect: the
 * gates it was given were the workspace route's, and that route can honestly
 * answer only two of five — it holds no Shopify order. A second derivation
 * from a strictly worse gate set is a second answer, and on a fraud case with
 * a cardholder-name mismatch it produced one.
 *
 * Deleting the browser's scorer moved that one layer down rather than removing
 * it. The function now renders what `buildPack` persisted.
 *
 * ── THE FOUR STATES ───────────────────────────────────────────────────
 *
 *   fresh snapshot        → its exact band, score and readiness
 *   absent snapshot       → needsRecalculation, every verdict value null
 *   hash mismatch         → needsRecalculation, and NOT the stale band
 *   unreconstructable hash→ needsRecalculation (unverifiable is not fresh)
 */

import { describe, it, expect } from "vitest";
import { buildWorkspaceAssessment } from "../workspaceAssessment";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { CaseAssessmentSnapshot, InputHash } from "@/lib/pipeline/contracts";
import { ASSESSMENT_POLICY_VERSION } from "@/lib/evidence/model/assessmentSnapshot";
import {
  FIXTURE_REVIEW_REQUIRED_NO_SAFE,
  FIXTURE_REVIEW_REQUIRED_SAFE,
} from "@/lib/pipeline/contracts/__fixtures__/cases";

const CURRENT_HASH = "hash-current" as InputHash;

function row(
  field: string,
  status: ChecklistItemV2["status"],
  priority: ChecklistItemV2["priority"] = "critical",
  blocking = false,
): ChecklistItemV2 {
  return {
    field,
    label: field,
    status,
    priority,
    blocking,
    source: "auto_shopify",
  } as ChecklistItemV2;
}

const COMPLETE: ChecklistItemV2[] = [
  row("order_confirmation", "available"),
  row("delivery_proof", "available"),
];

const WITH_GAP: ChecklistItemV2[] = [
  row("order_confirmation", "available"),
  row("delivery_proof", "missing"),
];

const BLOCKED: ChecklistItemV2[] = [
  row("order_confirmation", "available"),
  row("delivery_proof", "missing", "critical", true),
];

/** A snapshot as `buildPack` would have persisted it. */
function snapshot(over: {
  overall?: CaseAssessmentSnapshot["strength"]["overall"];
  score?: number;
  readiness?: CaseAssessmentSnapshot["completeness"]["readiness"];
  inputHash?: string;
  policyVersion?: number;
} = {}): CaseAssessmentSnapshot {
  const overall = over.overall ?? "strong";
  return {
    caseId: "d1",
    assessmentVersion: 1,
    strength: {
      overall,
      score: 9,
      coveragePercent: 90,
      strongCount: 2,
      moderateCount: 1,
      supportingCount: 0,
      supportedClaims: 3,
      totalClaims: 3,
      improvementHintI18n: null,
      strengthReasonI18n: { key: "disputes.strengthReason.general.strong" },
      heroVariant: overall === "strong" ? "likely_to_win" : "could_win",
    },
    completeness: {
      score: over.score ?? 88,
      evidenceStrengthScore: 80,
      readiness: over.readiness ?? "ready",
      blockers: [],
    },
    gateDecision: null,
    reviewRequiredCount: 0,
    modelVersion: 1,
    freshness: {
      inputHash: (over.inputHash ?? CURRENT_HASH) as InputHash,
      policyVersion: over.policyVersion ?? ASSESSMENT_POLICY_VERSION,
      computedAt: "2026-08-10T00:00:00.000Z",
    },
  };
}

function build(
  checklist: ChecklistItemV2[],
  overrides: Partial<Parameters<typeof buildWorkspaceAssessment>[0]> = {},
) {
  return buildWorkspaceAssessment({
    disputeId: "d1",
    checklist,
    reason: "PRODUCT_NOT_RECEIVED",
    payloadSource: undefined,
    snapshot: snapshot(),
    currentInputHash: CURRENT_HASH,
    packSaved: false,
    ...overrides,
  });
}

describe("a FRESH snapshot is projected exactly", () => {
  it("band, score and readiness are the snapshot's own values", () => {
    const snap = snapshot({ overall: "moderate", score: 73, readiness: "ready_with_warnings" });
    const p = build(WITH_GAP, { snapshot: snap });
    expect(p.assessment.needsRecalculation).toBe(false);
    expect(p.assessment.recalculationReason).toBeNull();
    expect(p.assessment.strengthBand).toBe("moderate");
    expect(p.assessment.completenessScore).toBe(73);
    expect(p.assessment.readiness).toBe("ready_with_warnings");
    expect(p.readiness).toBe("ready_with_warnings");
    // The full scorer result travels too, and it is the SNAPSHOT's.
    expect(p.caseStrength.overall).toBe("moderate");
    expect(p.caseStrength.heroVariant).toBe("could_win");
  });

  it("readiness is NOT recomputed from the checklist", () => {
    /* The old implementation derived readiness from the rows, which is a
     * second completeness derivation. A snapshot that says `ready` over a
     * checklist with a blocking gap must render `ready` — the snapshot is the
     * authority, and disagreeing with it silently is the divergence. */
    const p = build(BLOCKED, { snapshot: snapshot({ readiness: "ready" }) });
    expect(p.readiness).toBe("ready");
    // The row COUNTS are still reported — they are display data, not a verdict.
    expect(p.blockerCount).toBe(1);
  });

  it("a saved pack reads `submitted` — lifecycle beats the snapshot", () => {
    // Telling the merchant "ready with warnings" about evidence Shopify
    // already holds is an instruction they cannot act on.
    const p = build(WITH_GAP, { packSaved: true });
    expect(p.readiness).toBe("submitted");
    expect(p.assessment.readiness).toBe("submitted");
  });
});

describe("an ABSENT snapshot produces no verdict", () => {
  it("needsRecalculation, with every verdict value null", () => {
    const p = build(COMPLETE, { snapshot: null });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
    expect(p.assessment.completenessScore).toBeNull();
    expect(p.assessment.readiness).toBeNull();
    expect(p.assessment.recalculationReason).toBe("snapshot_absent");
  });
});

describe("a STALE snapshot cannot render its band", () => {
  it("a hash mismatch withholds a STRONG band", () => {
    /* The case that matters most. The snapshot says `strong`; the evidence has
     * moved since. Rendering `strong` would be a verdict about evidence that is
     * no longer there, and the merchant would act on it. */
    const p = build(COMPLETE, {
      snapshot: snapshot({ overall: "strong", inputHash: "hash-old" }),
      currentInputHash: CURRENT_HASH,
    });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
    expect(p.assessment.recalculationReason).toBe("input_hash_mismatch");
  });

  it("a superseded policy version withholds it too", () => {
    const p = build(COMPLETE, {
      snapshot: snapshot({ policyVersion: ASSESSMENT_POLICY_VERSION - 1 }),
    });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.recalculationReason).toBe("policy_version_superseded");
  });

  it("an UNRECONSTRUCTABLE current hash is not fresh either", () => {
    /* A legacy pack carrying a snapshot but no persisted gate fingerprint.
     * The caller cannot form a current hash, so the snapshot cannot be
     * verified — and unverifiable is not fresh. Rendering it as current would
     * mean "we could not check, so we assumed". */
    const p = build(COMPLETE, { currentInputHash: null });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
  });
});

describe("display-only rows survive, and cannot re-band the case", () => {
  it("contributions and improvement are still produced while unassessed", () => {
    /* They are labels — "what supports your case", the top missing signal —
     * and the merchant can still act on them. What they must not do is imply
     * a verdict, which `assessmentPresence` prevents at every surface. */
    const p = build(WITH_GAP, { snapshot: null });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.contributions).toBeDefined();
    expect(p.improvement === null || typeof p.improvement === "object").toBe(true);
  });

  it("the payload carries no band of its own while unassessed", () => {
    // `caseStrength` is the scorer's "nothing to assess" sentinel here, and
    // the projection says so. Consumers branch on the flag, never on the band.
    const p = build(COMPLETE, { snapshot: null });
    expect(p.assessment.strengthBand).toBeNull();
    expect(p.caseStrength.overall).toBe("insufficient");
  });
});

describe("deadline_only filing copy", () => {
  it("with no plan, filing is `normal` and nothing is held", () => {
    const p = build(COMPLETE);
    expect(p.filing.state).toEqual({ kind: "normal" });
    expect(p.filing.filingOutcome).toBe("adding_now");
    expect(p.assessment.reviewItems).toEqual([]);
  });

  it("a review_required exclusion makes it deadline_only, counted", () => {
    const p = build(COMPLETE, { plan: FIXTURE_REVIEW_REQUIRED_SAFE.plan });
    expect(p.filing.state).toEqual({ kind: "deadline_only", itemCount: 1 });
    // SCHEDULED for deadline processing — not a promise that it is filed.
    expect(p.filing.filingOutcome).toBe("scheduled_for_deadline");
    expect(p.filing.bodyToken.params).toEqual({ itemCount: 1 });
    expect(p.assessment.reviewItems).toHaveLength(1);
  });

  it("no safe argument outranks deadline_only", () => {
    const p = build(COMPLETE, { plan: FIXTURE_REVIEW_REQUIRED_NO_SAFE.plan });
    expect(p.filing.state).toEqual({ kind: "withheld_no_safe_argument" });
    expect(p.filing.filingOutcome).toBe("not_adding");
  });

  it("review items survive staleness — the merchant keeps their lever", () => {
    /* Hiding "one item needs your confirmation" while a recalculation is
     * pending would remove the only thing the merchant can do, at exactly the
     * moment they are being asked to wait. */
    const p = build(COMPLETE, {
      snapshot: snapshot({ inputHash: "hash-old" }),
      plan: FIXTURE_REVIEW_REQUIRED_SAFE.plan,
    });
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.reviewItems).toHaveLength(1);
  });
});

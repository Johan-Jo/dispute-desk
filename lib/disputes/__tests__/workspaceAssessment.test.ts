/**
 * CP-A — `buildWorkspaceAssessment`, the one derivation the workspace ships.
 *
 * This is the function Agent C calls from
 * `app/api/disputes/[id]/workspace/route.ts`. It is tested here, separately,
 * precisely because the route is not CP-A's to edit: a pure function with its
 * own suite is what makes the hand-off reviewable rather than a promise.
 */

import { describe, it, expect } from "vitest";
import {
  buildWorkspaceAssessment,
  emptyWorkspaceAssessment,
} from "../workspaceAssessment";
import { gatesWith, NO_GATES } from "@/tests/helpers/caseStrengthGates";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { FIXTURE_REVIEW_REQUIRED_NO_SAFE, FIXTURE_REVIEW_REQUIRED_SAFE } from "@/lib/pipeline/contracts/__fixtures__/cases";

function row(
  field: string,
  status: ChecklistItemV2["status"],
  priority: ChecklistItemV2["priority"] = "critical",
  blocking = false,
): ChecklistItemV2 {
  return { field, label: field, status, priority, blocking, source: "auto_shopify" };
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

function build(checklist: ChecklistItemV2[], overrides: Partial<Parameters<typeof buildWorkspaceAssessment>[0]> = {}) {
  return buildWorkspaceAssessment({
    disputeId: "d1",
    checklist,
    reason: "PRODUCT_NOT_RECEIVED",
    payloadSource: undefined,
    gates: NO_GATES,
    packSaved: false,
    ...overrides,
  });
}

describe("buildWorkspaceAssessment — readiness derived once", () => {
  it("no gaps → ready", () => {
    expect(build(COMPLETE).readiness).toBe("ready");
  });

  it("a critical non-blocking gap → ready_with_warnings, and it is a WARNING not a blocker", () => {
    const p = build(WITH_GAP);
    expect(p.readiness).toBe("ready_with_warnings");
    expect(p.warningCount).toBe(1);
    expect(p.blockerCount).toBe(0);
    expect(p.submitOverrideGaps).toEqual([
      { field: "delivery_proof", label: "delivery_proof" },
    ]);
  });

  it("a blocking gap → blocked", () => {
    const p = build(BLOCKED);
    expect(p.readiness).toBe("blocked");
    expect(p.blockerCount).toBe(1);
    // A blocking row is not ALSO a warning. Double-counting it would show the
    // merchant two problems where there is one.
    expect(p.warningCount).toBe(0);
  });

  it("a saved pack reads `submitted` even with gaps — lifecycle beats completeness", () => {
    // Telling the merchant "ready with warnings" about evidence Shopify
    // already holds is an instruction they cannot act on.
    const p = build(WITH_GAP, { packSaved: true });
    expect(p.readiness).toBe("submitted");
    expect(p.assessment.readiness).toBe("submitted");
  });
});

describe("buildWorkspaceAssessment — the projection agrees with the payload", () => {
  it("band and score are the SAME values on both, by construction", () => {
    // Two fields describing one case is how the divergence started. They are
    // read from one derivation here, so they cannot disagree.
    const p = build(WITH_GAP);
    expect(p.assessment.strengthBand).toBe(p.caseStrength.overall);
    expect(p.assessment.needsRecalculation).toBe(false);
    expect(p.assessment.recalculationReason).toBeNull();
    expect(typeof p.assessment.completenessScore).toBe("number");
  });

  it("applies the gates it is given — a covered case is not scored as an ordinary one", () => {
    const covered = build(COMPLETE, {
      gates: gatesWith({
        coverage: { state: "covered_shopify", shopifyProtectStatus: "PROTECTED" },
      }),
    });
    expect(covered.caseStrength.heroVariant).toBe("covered");
  });
});

describe("buildWorkspaceAssessment — deadline_only filing copy", () => {
  it("with no plan, filing is `normal` and nothing is held", () => {
    const p = build(COMPLETE);
    expect(p.filing.state).toEqual({ kind: "normal" });
    expect(p.filing.willFile).toBe(true);
    expect(p.assessment.reviewItems).toEqual([]);
  });

  it("a review_required exclusion makes it deadline_only, counted", () => {
    const p = build(COMPLETE, { plan: FIXTURE_REVIEW_REQUIRED_SAFE.plan });
    expect(p.filing.state).toEqual({ kind: "deadline_only", itemCount: 1 });
    expect(p.filing.willFile).toBe(true);
    expect(p.filing.bodyToken.params).toEqual({ itemCount: 1 });
    expect(p.assessment.reviewItems).toHaveLength(1);
  });

  it("no safe argument outranks deadline_only and says it will NOT file", () => {
    const p = build(COMPLETE, { plan: FIXTURE_REVIEW_REQUIRED_NO_SAFE.plan });
    expect(p.filing.state).toEqual({ kind: "withheld_no_safe_argument" });
    expect(p.filing.willFile).toBe(false);
  });

  it("filing state is read from the PLAN, not from the band", () => {
    // A weak case with a safe argument still files; a strong case whose only
    // support was excluded does not. Deriving filing from strength inverts
    // both.
    const weakButSafe = build([row("order_confirmation", "missing")], {
      plan: { ...FIXTURE_REVIEW_REQUIRED_SAFE.plan, deadlineOnly: false, excluded: [] },
    });
    expect(weakButSafe.caseStrength.overall).toBe("weak");
    expect(weakButSafe.filing.willFile).toBe(true);
  });
});

describe("emptyWorkspaceAssessment", () => {
  it("is needsRecalculation with every value nulled", () => {
    const p = emptyWorkspaceAssessment("d1");
    expect(p.assessment.needsRecalculation).toBe(true);
    expect(p.assessment.strengthBand).toBeNull();
    expect(p.assessment.completenessScore).toBeNull();
    expect(p.assessment.readiness).toBeNull();
    expect(p.assessment.recalculationReason).toBe("snapshot_absent");
  });

  it("carries the scorer's 'nothing to assess' band, not a judgement", () => {
    // `insufficient` here is the absence of an assessment. Any consumer that
    // renders it without checking `needsRecalculation` is telling the
    // merchant their case is hopeless because a request had no pack.
    const p = emptyWorkspaceAssessment("d1");
    expect(p.caseStrength.overall).toBe("insufficient");
    expect(p.caseStrength.score).toBe(0);
  });

  it("distinguishes the three staleness reasons", () => {
    expect(emptyWorkspaceAssessment("d1", "input_hash_mismatch").assessment.recalculationReason)
      .toBe("input_hash_mismatch");
    expect(
      emptyWorkspaceAssessment("d1", "policy_version_superseded").assessment.recalculationReason,
    ).toBe("policy_version_superseded");
  });
});

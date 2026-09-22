/**
 * Review-state derivation tests (plan §11, §17).
 *
 * `deriveReviewState` is pure so the precedence rules can be pinned without a
 * database. The rules matter: the current state is derived from an append-only
 * history, and an audit trail that silently loses an earlier decision cannot
 * support the "only reviewed findings may drive change" rule it exists for.
 */

import { describe, expect, it } from "vitest";
import { deriveReviewState, type ReviewRecord } from "../reviews";

function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "r-1",
    analysisId: "a-1",
    reviewerUserId: "u-1",
    disposition: "CONFIRMED",
    categoryOverride: null,
    confidenceOverride: null,
    notes: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("an unreviewed analysis is a hypothesis", () => {
  it("reports PENDING_REVIEW and keeps the analyzer's own values", () => {
    const state = deriveReviewState([], "AVAILABLE_EVIDENCE_OMITTED", "DEFINITE");
    expect(state.state).toBe("PENDING_REVIEW");
    expect(state.reviewCount).toBe(0);
    expect(state.effectiveCategory).toBe("AVAILABLE_EVIDENCE_OMITTED");
    expect(state.effectiveConfidence).toBe("DEFINITE");
  });
});

describe("the latest review wins, and the earlier ones survive", () => {
  it("takes the most recent disposition", () => {
    const state = deriveReviewState(
      [
        review({ id: "r-1", disposition: "CONFIRMED", createdAt: "2026-08-30T10:00:00.000Z" }),
        review({ id: "r-2", disposition: "REJECTED", notes: "not a defect", createdAt: "2026-08-31T10:00:00.000Z" }),
      ],
      "UNSUPPORTED_OR_OVERSTATED_ASSERTION",
      "MODERATE",
    );
    expect(state.state).toBe("REJECTED");
    expect(state.latest?.id).toBe("r-2");
    // The earlier confirmation is not erased — it is still counted.
    expect(state.reviewCount).toBe(2);
  });

  it("orders by time, not by array position", () => {
    const state = deriveReviewState(
      [
        review({ id: "late", disposition: "REJECTED", notes: "n", createdAt: "2026-08-31T10:00:00.000Z" }),
        review({ id: "early", disposition: "CONFIRMED", createdAt: "2026-08-30T10:00:00.000Z" }),
      ],
      "INDETERMINATE",
      "LOW",
    );
    expect(state.latest?.id).toBe("late");
  });
});

describe("overrides apply from the latest review only", () => {
  it("uses a reviewer's correction over the analyzer's category", () => {
    const state = deriveReviewState(
      [
        review({
          disposition: "EDITED",
          categoryOverride: "NO_MATERIAL_GAP_OBSERVED",
          confidenceOverride: "LOW",
          notes: "withholding was correct here",
        }),
      ],
      "AVAILABLE_EVIDENCE_OMITTED",
      "DEFINITE",
    );
    expect(state.effectiveCategory).toBe("NO_MATERIAL_GAP_OBSERVED");
    expect(state.effectiveConfidence).toBe("LOW");
  });

  it("does not let a superseded override leak back", () => {
    // An earlier edit that a later review replaced must not survive into the
    // effective values — that would be the audit trail lying by omission.
    const state = deriveReviewState(
      [
        review({
          id: "r-1",
          disposition: "EDITED",
          categoryOverride: "NO_MATERIAL_GAP_OBSERVED",
          notes: "first take",
          createdAt: "2026-08-30T10:00:00.000Z",
        }),
        review({
          id: "r-2",
          disposition: "CONFIRMED",
          createdAt: "2026-08-31T10:00:00.000Z",
        }),
      ],
      "AVAILABLE_EVIDENCE_OMITTED",
      "DEFINITE",
    );
    expect(state.state).toBe("CONFIRMED");
    expect(state.effectiveCategory).toBe("AVAILABLE_EVIDENCE_OMITTED");
  });
});

describe("ties are broken deterministically", () => {
  it("picks the same winner every time when timestamps are identical", () => {
    // Postgres now() is transaction time, so same-transaction inserts tie.
    // A tie must not make the current state flap between reads.
    const a = review({ id: "aaa", disposition: "CONFIRMED", createdAt: "2026-08-31T10:00:00.000Z" });
    const b = review({ id: "bbb", disposition: "REJECTED", notes: "n", createdAt: "2026-08-31T10:00:00.000Z" });
    const first = deriveReviewState([a, b], "INDETERMINATE", "LOW");
    const second = deriveReviewState([b, a], "INDETERMINATE", "LOW");
    expect(first.state).toBe(second.state);
    expect(first.latest?.id).toBe(second.latest?.id);
  });
});

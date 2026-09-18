/**
 * Learning-action lifecycle tests (plan §19 learning-action block).
 *
 * The load-bearing one is the first: an unreviewed finding cannot approve an
 * action. That is the rule separating "a human confirmed this" from "an
 * automated hypothesis changed production", and it is enforced here and again
 * by a database trigger.
 */

import { describe, expect, it } from "vitest";
import {
  canTransition,
  checkTransition,
  evaluationVerdict,
  type LearningActionState,
} from "../learningActions";

function state(overrides: Partial<LearningActionState> = {}): LearningActionState {
  return {
    status: "READY_FOR_REVIEW",
    scopeType: "REASON_NETWORK",
    ownerUserId: "u-1",
    approvedBy: null,
    approvedAt: null,
    deploymentRef: null,
    effectiveFrom: null,
    rollbackRef: null,
    baselineCohortDefinition: { phase: "chargeback" },
    baselineMetrics: { peerCases: 40 },
    evidence: [{ analysisId: "a-1", reviewDisposition: "CONFIRMED" }],
    ...overrides,
  };
}

describe("only reviewed findings can approve an action", () => {
  it("refuses approval on an unreviewed finding", () => {
    const check = checkTransition(
      state({ evidence: [{ analysisId: "a-1", reviewDisposition: "PENDING_REVIEW" }] }),
      "APPROVED",
    );
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/not confirmed by a reviewer/);
  });

  it("refuses approval on a REJECTED finding", () => {
    // A rejection is a review, but it is not support.
    const check = checkTransition(
      state({ evidence: [{ analysisId: "a-1", reviewDisposition: "REJECTED" }] }),
      "APPROVED",
    );
    expect(check.allowed).toBe(false);
  });

  it("accepts CONFIRMED and EDITED as support", () => {
    expect(checkTransition(state(), "APPROVED").allowed).toBe(true);
    expect(
      checkTransition(
        state({ evidence: [{ analysisId: "a-1", reviewDisposition: "EDITED" }] }),
        "APPROVED",
      ).allowed,
    ).toBe(true);
  });

  it("refuses approval with no findings at all", () => {
    const check = checkTransition(state({ evidence: [] }), "APPROVED");
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/no supporting findings/);
  });
});

describe("one case is an anecdote", () => {
  it("refuses a PLATFORM action backed by a single finding", () => {
    const check = checkTransition(state({ scopeType: "PLATFORM" }), "APPROVED");
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/more than one supporting finding/);
  });

  it("allows a PLATFORM action on two confirmed findings", () => {
    const check = checkTransition(
      state({
        scopeType: "PLATFORM",
        evidence: [
          { analysisId: "a-1", reviewDisposition: "CONFIRMED" },
          { analysisId: "a-2", reviewDisposition: "CONFIRMED" },
        ],
      }),
      "APPROVED",
    );
    expect(check.allowed).toBe(true);
  });

  it("still lets a single finding open a draft", () => {
    // Plan §15.8: one case may create a hypothesis, just not a fleet change.
    expect(canTransition("DRAFT", "READY_FOR_REVIEW")).toBe(true);
    expect(
      checkTransition(
        state({ status: "DRAFT", evidence: [{ analysisId: "a-1", reviewDisposition: "PENDING_REVIEW" }] }),
        "READY_FOR_REVIEW",
      ).allowed,
    ).toBe(true);
  });
});

describe("a baseline is frozen before the change, not after", () => {
  it("refuses approval with no frozen baseline", () => {
    const check = checkTransition(
      state({ baselineCohortDefinition: null, baselineMetrics: null }),
      "APPROVED",
    );
    expect(check.reasons.join(" ")).toMatch(/baseline must be frozen/);
  });
});

describe("deployment records how it happened and how to undo it", () => {
  const approved = state({
    status: "APPROVED",
    approvedBy: "u-2",
    approvedAt: "2026-08-31T10:00:00.000Z",
  });

  it("refuses a deployment with no release reference", () => {
    const check = checkTransition(approved, "DEPLOYED");
    expect(check.allowed).toBe(false);
    expect(check.reasons.join(" ")).toMatch(/reference the release/);
  });

  it("refuses a deployment with no rollback plan", () => {
    const check = checkTransition(
      { ...approved, deploymentRef: "PR#620", effectiveFrom: "2026-09-01T00:00:00.000Z" },
      "DEPLOYED",
    );
    expect(check.reasons.join(" ")).toMatch(/how it can be reversed/);
  });

  it("accepts a fully recorded deployment", () => {
    const check = checkTransition(
      {
        ...approved,
        deploymentRef: "PR#620",
        effectiveFrom: "2026-09-01T00:00:00.000Z",
        rollbackRef: "revert PR#620",
      },
      "DEPLOYED",
    );
    expect(check.allowed).toBe(true);
  });
});

describe("rollback is always reachable after deployment", () => {
  it("does not force a detour through MEASURING", () => {
    // The moment you need a rollback is the moment something is wrong.
    expect(canTransition("DEPLOYED", "ROLL_BACK")).toBe(true);
    expect(canTransition("MEASURING", "ROLL_BACK")).toBe(true);
    expect(canTransition("KEEP", "ROLL_BACK")).toBe(true);
  });

  it("refuses an illegal jump", () => {
    expect(canTransition("DRAFT", "DEPLOYED")).toBe(false);
    expect(canTransition("CLOSED_INDETERMINATE", "DRAFT")).toBe(false);
  });
});

describe("evaluation verdicts stay inside the evidence", () => {
  it("never reports promising on an insufficient sample", () => {
    expect(
      evaluationVerdict({
        sampleQuality: "INSUFFICIENT",
        guardrailRegression: false,
        baselineWinRate: 0.1,
        postChangeWinRate: 0.9,
      }),
    ).toBe("INSUFFICIENT_SAMPLE");
  });

  it("never reports promising on a directional sample", () => {
    expect(
      evaluationVerdict({
        sampleQuality: "DIRECTIONAL",
        guardrailRegression: false,
        baselineWinRate: 0.1,
        postChangeWinRate: 0.9,
      }),
    ).toBe("NO_CLEAR_CHANGE");
  });

  it("lets a guardrail regression outrank an improvement", () => {
    expect(
      evaluationVerdict({
        sampleQuality: "SUFFICIENT",
        guardrailRegression: true,
        baselineWinRate: 0.1,
        postChangeWinRate: 0.9,
      }),
    ).toBe("ADVERSE_GUARDRAIL");
  });

  it("reports promising only on a sufficient, clean improvement", () => {
    expect(
      evaluationVerdict({
        sampleQuality: "SUFFICIENT",
        guardrailRegression: false,
        baselineWinRate: 0.3,
        postChangeWinRate: 0.45,
      }),
    ).toBe("PROMISING");
  });

  it("is indeterminate when a rate is missing", () => {
    expect(
      evaluationVerdict({
        sampleQuality: "SUFFICIENT",
        guardrailRegression: false,
        baselineWinRate: null,
        postChangeWinRate: 0.4,
      }),
    ).toBe("INDETERMINATE");
  });
});

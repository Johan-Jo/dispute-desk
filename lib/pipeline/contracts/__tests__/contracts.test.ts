/**
 * Contract-commit tests.
 *
 * These do not test an implementation — none exists yet. They pin the two
 * things three parallel agents can silently disagree about: what the shared
 * fixtures mean, and what the shared predicates do. If a later contract
 * revision changes either, this suite fails on the epic branch rather than in
 * PR 2's integration.
 */

import { describe, expect, it } from "vitest";
import {
  CONTRACT_FIXTURES,
  FIXTURE_COMPUTED_AT,
  FIXTURE_REVIEW_REQUIRED_NO_SAFE,
  FIXTURE_REVIEW_REQUIRED_SAFE,
  FIXTURE_STALE,
  FIXTURE_STRONG,
} from "../__fixtures__/cases";
import { evaluateFreshness } from "../freshness";
import { mayExecuteAtDeadline, type DeadlineExecutionConditions } from "../automationDecision";
import { isFileable, type FileableSelection } from "../fileableSelection";

describe("shared fixtures", () => {
  it("covers the nine agreed scenarios, by name", () => {
    expect(CONTRACT_FIXTURES.map((f) => f.name)).toEqual([
      "strong",
      "weak",
      "complete",
      "incomplete",
      "hard_blocked",
      "covered_conceded",
      "stale",
      "review_required_safe_argument",
      "review_required_no_safe_argument",
    ]);
  });

  it("gives every fixture a stated intent", () => {
    for (const f of CONTRACT_FIXTURES) {
      expect(f.intent.length, `${f.name} has no intent`).toBeGreaterThan(20);
    }
  });

  it("uses fixed instants, never a clock", () => {
    for (const f of CONTRACT_FIXTURES) {
      expect(f.assessment.freshness.computedAt).toBe(FIXTURE_COMPUTED_AT);
      expect(f.decision.freshness.computedAt).toBe(FIXTURE_COMPUTED_AT);
    }
  });

  /**
   * The safety property, asserted over the whole set rather than case by case:
   * a deadline may never turn a "no" into a "yes" for a hard block, coverage,
   * staleness or a missing safe argument. Only `deadline_only_not_yet_due` may
   * differ between the two triggers.
   */
  it("lets the deadline trigger differ from normal ONLY on deadline_only eligibility", () => {
    for (const f of CONTRACT_FIXTURES) {
      if (f.expected.normal === f.expected.deadline) continue;
      expect(
        f.expected.normalReason,
        `${f.name}: deadline may only upgrade a deadline_only decline`,
      ).toBe("deadline_only_not_yet_due");
      expect(f.expected.deadline).toBe("selected");
    }
  });

  /**
   * Revision 2. The property that stops the defect returning: strength is an
   * ODDS judgement, and odds may never withhold a filing. Filing nothing does
   * not produce silence — Shopify files its own scrape — so the only grounds
   * for a hard block are honesty grounds: coverage/concession, fatal-loss, or an
   * unsafe claim.
   */
  it("never lets weak or insufficient strength produce a hard block", () => {
    for (const f of CONTRACT_FIXTURES) {
      if (f.assessment.gateDecision !== null) continue; // coverage / fatal-loss may block
      if (f.plan.noSafeArgument !== null) continue; // no argument to file is not an odds call
      const strengthOnly =
        f.assessment.strength.overall === "weak" || f.assessment.strength.overall === "insufficient";
      if (!strengthOnly) continue;
      expect(f.expected.deadlineReason, `${f.name}: strength must not read as a hard block`).not.toBe(
        "hard_block",
      );
      expect(f.expected.deadline, `${f.name}: a thin but honest case still files at the deadline`).toBe(
        "selected",
      );
    }
  });

  it("never files a case with no safe argument, on either trigger", () => {
    const f = FIXTURE_REVIEW_REQUIRED_NO_SAFE;
    expect(f.plan.noSafeArgument).not.toBeNull();
    expect(f.expected.normal).toBe("none");
    expect(f.expected.deadline).toBe("none");
    expect(f.expected.deadlineReason).toBe("no_safe_argument");
  });

  it("excludes review_required material from the argument while keeping its merchant reason", () => {
    const f = FIXTURE_REVIEW_REQUIRED_SAFE;
    const excluded = f.plan.excluded.find((e) => e.reason === "review_required");
    expect(excluded).toBeDefined();
    expect(excluded?.merchantReasonToken).toBeTruthy();
    expect(excluded?.factCategory).toBeTruthy();
    // The excluded record must not also be included — that is the orphaned-claim bug.
    expect(f.plan.included.map((i) => i.recordId)).not.toContain(excluded?.recordId);
    expect(f.plan.deadlineOnly).toBe(true);
  });
});

describe("evaluateFreshness", () => {
  const current = { currentInputHash: "h1", currentPolicyVersion: 1 };

  it("distinguishes absent from mismatched", () => {
    expect(evaluateFreshness({ snapshot: null, ...current })).toEqual({
      fresh: false,
      reason: "snapshot_absent",
    });
    expect(
      evaluateFreshness({
        snapshot: { inputHash: "h0", policyVersion: 1, computedAt: FIXTURE_COMPUTED_AT },
        ...current,
      }),
    ).toEqual({ fresh: false, reason: "input_hash_mismatch" });
  });

  it("treats a policy bump as stale even when inputs are identical", () => {
    expect(
      evaluateFreshness({
        snapshot: { inputHash: "h1", policyVersion: 0, computedAt: FIXTURE_COMPUTED_AT },
        ...current,
      }),
    ).toEqual({ fresh: false, reason: "policy_version_superseded" });
  });

  it("ignores computedAt entirely — time alone never stales a snapshot", () => {
    const old = { inputHash: "h1", policyVersion: 1, computedAt: "1999-01-01T00:00:00.000Z" };
    expect(evaluateFreshness({ snapshot: old, ...current })).toEqual({ fresh: true });
  });

  it("marks the stale fixture stale and the strong fixture fresh", () => {
    expect(
      evaluateFreshness({
        snapshot: FIXTURE_STALE.assessment.freshness,
        currentInputHash: "stale-assessment",
        currentPolicyVersion: 1,
      }).fresh,
    ).toBe(false);
    expect(
      evaluateFreshness({
        snapshot: FIXTURE_STRONG.assessment.freshness,
        currentInputHash: "strong-assessment",
        currentPolicyVersion: 1,
      }).fresh,
    ).toBe(true);
  });
});

describe("mayExecuteAtDeadline — P-6, conjunctive", () => {
  const allTrue: DeadlineExecutionConditions = {
    hasCurrentCanonicalDecision: true,
    hasCurrentValidatedSafePackage: true,
    noHardBlock: true,
    notStale: true,
    noAmbiguity: true,
    noUnsupportedArgument: true,
  };

  it("permits execution only when every condition holds", () => {
    expect(mayExecuteAtDeadline(allTrue)).toBe(true);
  });

  it("refuses when any single condition fails", () => {
    for (const key of Object.keys(allTrue) as (keyof DeadlineExecutionConditions)[]) {
      expect(mayExecuteAtDeadline({ ...allTrue, [key]: false }), `${key} must be load-bearing`).toBe(
        false,
      );
    }
  });
});

describe("FileableSelection", () => {
  it("narrows only on the selected outcome", () => {
    const selected: FileableSelection = {
      outcome: "selected",
      trigger: "deadline",
      package: { packageId: "p1", packageVersion: 3, artifactId: "a1" },
    };
    const ambiguous: FileableSelection = {
      outcome: "ambiguous",
      trigger: "normal",
      candidateIds: ["p1", "p2"],
    };
    expect(isFileable(selected)).toBe(true);
    expect(isFileable(ambiguous)).toBe(false);
  });

  it("carries every candidate on ambiguity, so the alert can show what the selector saw", () => {
    const ambiguous: FileableSelection = {
      outcome: "ambiguous",
      trigger: "normal",
      candidateIds: ["p1", "p2"],
    };
    if (ambiguous.outcome !== "ambiguous") throw new Error("unreachable");
    expect(ambiguous.candidateIds.length).toBeGreaterThan(1);
  });
});

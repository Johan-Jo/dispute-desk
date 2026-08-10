/**
 * THE required test (EPIC CP-C §"Time-invariance").
 *
 * Evaluate identical inputs at two different clock times and assert an
 * identical `inputHash` AND identical `reasonCodes`. A due-date change is an
 * input change and MUST move the hash.
 *
 * This is the property most likely to be got wrong, because the due date is
 * both a declared input and the thing executors recompute. If any relative time
 * state leaked into the decision, the first assertion below would fail on a
 * machine that ran the suite at a different hour.
 */

import { describe, expect, it } from "vitest";
import {
  FIXTURE_DUE_AT,
  FIXTURE_STRONG,
} from "@/lib/pipeline/contracts/__fixtures__/cases";
import {
  deriveCaseAutomationDecision,
  type CaseAutomationDecisionInput,
} from "../deriveCaseAutomationDecision";
import { AUTOMATION_POLICY_VERSION } from "../policy";

function input(
  overrides: Partial<CaseAutomationDecisionInput> = {},
): CaseAutomationDecisionInput {
  return {
    caseId: "case-1",
    assessment: FIXTURE_STRONG.assessment,
    assessmentFreshness: { fresh: true },
    policy: {
      version: AUTOMATION_POLICY_VERSION,
      autoSaveEnabled: true,
      completenessThreshold: 60,
      enforceNoBlockers: true,
    },
    automationMode: "auto",
    // Revision 1: coverage and fatal-loss moved onto `assessment.gateDecision`;
    // credit-already-issued is the only gate fact still passed beside it.
    gates: { creditAlreadyIssued: null },
    evidenceDueAt: FIXTURE_DUE_AT,
    computedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

describe("CaseAutomationDecision — time invariance", () => {
  it("two different clock times produce an identical hash and reason codes", () => {
    const monday = deriveCaseAutomationDecision(
      input({ computedAt: "2026-08-10T06:00:00.000Z" }),
    );
    const friday = deriveCaseAutomationDecision(
      input({ computedAt: "2026-08-14T23:59:59.000Z" }),
    );

    expect(friday.freshness.inputHash).toBe(monday.freshness.inputHash);
    expect(friday.reasonCodes).toEqual(monday.reasonCodes);
    expect(friday.action).toBe(monday.action);
  });

  it("computedAt is carried for audit but never enters the hash", () => {
    const a = deriveCaseAutomationDecision(input({ computedAt: "2026-01-01T00:00:00.000Z" }));
    const b = deriveCaseAutomationDecision(input({ computedAt: "2027-12-31T00:00:00.000Z" }));
    expect(a.freshness.computedAt).not.toBe(b.freshness.computedAt);
    expect(a.freshness.inputHash).toBe(b.freshness.inputHash);
  });

  it("a due-date change IS an input change and moves the hash", () => {
    const original = deriveCaseAutomationDecision(input());
    const rescheduled = deriveCaseAutomationDecision(
      input({ evidenceDueAt: "2026-09-01T00:00:00.000Z" }),
    );
    expect(rescheduled.freshness.inputHash).not.toBe(original.freshness.inputHash);
  });

  it("clearing the due date moves the hash too", () => {
    const withDue = deriveCaseAutomationDecision(input());
    const withoutDue = deriveCaseAutomationDecision(input({ evidenceDueAt: null }));
    expect(withoutDue.freshness.inputHash).not.toBe(withDue.freshness.inputHash);
  });

  it("the snapshot carries an ABSOLUTE instant, never a relative time state", () => {
    const decision = deriveCaseAutomationDecision(input());
    expect(decision.evidenceDueAt).toBe(FIXTURE_DUE_AT);
    // Nothing duration- or window-shaped may appear anywhere on the snapshot.
    const serialized = JSON.stringify(decision);
    for (const forbidden of [
      "daysRemaining",
      "hoursRemaining",
      "timeRemaining",
      "windowOpen",
      "isDue",
      "dueIn",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("every result-bearing input moves the hash", () => {
    const base = deriveCaseAutomationDecision(input()).freshness.inputHash;
    const variants: Array<[string, Partial<CaseAutomationDecisionInput>]> = [
      ["automationMode", { automationMode: "review" }],
      [
        "policy threshold",
        {
          policy: {
            version: AUTOMATION_POLICY_VERSION,
            autoSaveEnabled: true,
            completenessThreshold: 90,
            enforceNoBlockers: true,
          },
        },
      ],
      /*
       * Revision 1 moved four of these onto the assessment. They are asserted
       * here EXACTLY as before — the point of this case is that every input
       * capable of changing the result also changes the hash, and moving an
       * input to a different object does not exempt it.
       *
       * These overrides deliberately hold `assessment.freshness.inputHash`
       * fixed while changing the field, so each assertion proves the decision
       * hashes THAT field rather than inheriting a difference from the
       * assessment's own hash.
       */
      [
        "coverage",
        { assessment: { ...FIXTURE_STRONG.assessment, gateDecision: "coverage" } },
      ],
      [
        "fatal loss",
        { assessment: { ...FIXTURE_STRONG.assessment, gateDecision: "fatal_loss" } },
      ],
      [
        "review-required count",
        { assessment: { ...FIXTURE_STRONG.assessment, reviewRequiredCount: 1 } },
      ],
      [
        "model version",
        { assessment: { ...FIXTURE_STRONG.assessment, modelVersion: 99 } },
      ],
      ["assessment freshness", { assessmentFreshness: { fresh: false, reason: "input_hash_mismatch" } }],
    ];
    for (const [label, override] of variants) {
      const hash = deriveCaseAutomationDecision(input(override)).freshness.inputHash;
      expect(hash, `${label} must change the hash`).not.toBe(base);
    }
  });

  it("the hash is order-insensitive across blocker lists", () => {
    const a = { ...FIXTURE_STRONG.assessment };
    const one = deriveCaseAutomationDecision(
      input({
        assessment: {
          ...a,
          completeness: { ...a.completeness, blockers: ["x", "y"] },
        },
      }),
    );
    const two = deriveCaseAutomationDecision(
      input({
        assessment: {
          ...a,
          completeness: { ...a.completeness, blockers: ["y", "x"] },
        },
      }),
    );
    expect(two.freshness.inputHash).toBe(one.freshness.inputHash);
  });
});

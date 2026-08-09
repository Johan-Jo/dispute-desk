/**
 * The decision ladder, and the two gates it must never move.
 *
 * §6 of the epic: Coverage Gate and Fatal-loss Gate behaviour UNCHANGED —
 * `COVERED_STATUSES` still exactly `{PROTECTED, ACTIVE}`, coverage still beats
 * fatal-loss, a covered pack is never auto-filed, fatal-loss caps the case and
 * blocks in auto mode, and no bank-facing text ever cites a fatal-loss reason.
 * These are asserted here against the ONE decision rather than against four
 * separate ladders, which is the point of the epic.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_FIXTURES, FIXTURE_DUE_AT } from "@/lib/pipeline/contracts/__fixtures__/cases";
import {
  deriveCaseAutomationDecision,
  type CaseAutomationDecisionInput,
} from "../deriveCaseAutomationDecision";
import { AUTOMATION_POLICY_VERSION } from "../policy";

const ROOT = join(__dirname, "..", "..", "..", "..");

function input(
  overrides: Partial<CaseAutomationDecisionInput> = {},
): CaseAutomationDecisionInput {
  const base = CONTRACT_FIXTURES[0];
  return {
    caseId: "case-1",
    assessment: base.assessment,
    assessmentFreshness: { fresh: true },
    policy: {
      version: AUTOMATION_POLICY_VERSION,
      autoSaveEnabled: true,
      completenessThreshold: 60,
      enforceNoBlockers: true,
    },
    automationMode: "auto",
    gates: { coverageState: null, fatalLoss: null, creditAlreadyIssued: null },
    reviewRequiredCount: 0,
    evidenceDueAt: FIXTURE_DUE_AT,
    computedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

const COVERED = {
  coverageState: "covered_shopify",
  fatalLoss: null,
  creditAlreadyIssued: null,
} as const;
const FATAL = {
  coverageState: null,
  fatalLoss: { triggered: true, reason: "refund_issued" },
  creditAlreadyIssued: null,
} as const;

describe("Coverage Gate — preserved", () => {
  it("a covered case blocks and names coverage_active", () => {
    const d = deriveCaseAutomationDecision(input({ gates: COVERED }));
    expect(d.action).toBe("block");
    expect(d.reasonCodes).toEqual(["coverage_active"]);
  });

  it("coverage BEATS fatal-loss", () => {
    const d = deriveCaseAutomationDecision(
      input({
        gates: {
          coverageState: "covered_shopify",
          fatalLoss: { triggered: true, reason: "refund_issued" },
          creditAlreadyIssued: null,
        },
      }),
    );
    expect(d.reasonCodes).toEqual(["coverage_active"]);
  });

  it("a covered case is NEVER auto-filed, at any strength or completeness", () => {
    for (const overall of ["strong", "moderate", "weak", "insufficient"] as const) {
      const a = CONTRACT_FIXTURES[0].assessment;
      const d = deriveCaseAutomationDecision(
        input({
          gates: COVERED,
          assessment: {
            ...a,
            strength: { ...a.strength, overall },
            completeness: { ...a.completeness, score: 100 },
          },
        }),
      );
      expect(d.action, overall).toBe("block");
    }
  });

  it("COVERED_STATUSES stays exactly {PROTECTED, ACTIVE}", () => {
    const src = readFileSync(
      join(ROOT, "lib", "packs", "sources", "coverageSource.ts"),
      "utf8",
    );
    const match = src.match(/const COVERED_STATUSES = new Set<string>\(\[([^\]]*)\]\)/);
    expect(match, "COVERED_STATUSES must still be a literal set").not.toBeNull();
    const members = match![1]
      .split(",")
      .map((m) => m.trim().replace(/"/g, ""))
      .filter(Boolean);
    // Exactly two. `PENDING` falls through to normal flow until Shopify decides.
    expect(members.sort()).toEqual(["ACTIVE", "PROTECTED"]);
  });

  it("only `covered_shopify` triggers the gate — no widening here", () => {
    for (const state of ["not_covered", "PENDING", "pending", "", "protected"]) {
      const d = deriveCaseAutomationDecision(
        input({ gates: { ...COVERED, coverageState: state } }),
      );
      expect(d.reasonCodes, state).not.toContain("coverage_active");
    }
  });
});

describe("Fatal-loss Gate — preserved", () => {
  it("auto mode BLOCKS on a fatal-loss trigger", () => {
    const d = deriveCaseAutomationDecision(input({ gates: FATAL }));
    expect(d.action).toBe("block");
    expect(d.reasonCodes).toEqual(["fatal_loss"]);
  });

  it("blocks even on a strong, complete case", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        gates: FATAL,
        assessment: {
          ...a,
          strength: { ...a.strength, overall: "strong" },
          completeness: { ...a.completeness, score: 100 },
        },
      }),
    );
    expect(d.action).toBe("block");
  });

  it("the fatal-loss REASON never leaves the decision as text", () => {
    const d = deriveCaseAutomationDecision(input({ gates: FATAL }));
    // The snapshot carries a machine code only. The specific trigger
    // (`refund_issued`) is merchant-UI/audit material and must not travel in
    // anything a bank-facing composer could pick up.
    expect(JSON.stringify(d)).not.toContain("refund_issued");
    expect(d.reasonCodes).toEqual(["fatal_loss"]);
  });

  it("an untriggered fatal_loss object does not block", () => {
    const d = deriveCaseAutomationDecision(
      input({
        gates: {
          coverageState: null,
          fatalLoss: { triggered: false, reason: null },
          creditAlreadyIssued: null,
        },
      }),
    );
    expect(d.action).toBe("auto_file");
  });
});

describe("the ladder", () => {
  it("a stale assessment blocks", () => {
    const d = deriveCaseAutomationDecision(
      input({ assessmentFreshness: { fresh: false, reason: "input_hash_mismatch" } }),
    );
    expect(d.action).toBe("block");
    expect(d.reasonCodes).toEqual(["assessment_stale"]);
  });

  it("a blocked readiness is a hard block", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        assessment: {
          ...a,
          completeness: { ...a.completeness, readiness: "blocked", blockers: ["x"] },
        },
      }),
    );
    expect(d.action).toBe("block");
    expect(d.reasonCodes).toEqual(["hard_block"]);
  });

  it("review mode parks, whatever the strength", () => {
    const d = deriveCaseAutomationDecision(input({ automationMode: "review" }));
    expect(d.action).toBe("park_for_review");
    expect(d.reasonCodes).toEqual(["automation_disabled"]);
  });

  it("a null automation mode is treated exactly like review", () => {
    expect(deriveCaseAutomationDecision(input({ automationMode: null })).reasonCodes).toEqual([
      "automation_disabled",
    ]);
  });

  it("auto-save disabled for the shop parks", () => {
    const d = deriveCaseAutomationDecision(
      input({
        policy: {
          version: AUTOMATION_POLICY_VERSION,
          autoSaveEnabled: false,
          completenessThreshold: 60,
          enforceNoBlockers: true,
        },
      }),
    );
    expect(d.reasonCodes).toEqual(["automation_disabled"]);
  });

  it("weak and insufficient block BEFORE completeness is consulted", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    for (const overall of ["weak", "insufficient"] as const) {
      const d = deriveCaseAutomationDecision(
        input({
          assessment: {
            ...a,
            strength: { ...a.strength, overall },
            completeness: { ...a.completeness, score: 5 },
          },
        }),
      );
      expect(d.action, overall).toBe("block");
      expect(d.reasonCodes, overall).toEqual(["strength_insufficient"]);
    }
  });

  it("below threshold PARKS — it is not a hard block, so the deadline may still file", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        assessment: {
          ...a,
          strength: { ...a.strength, overall: "moderate" },
          completeness: { ...a.completeness, score: 35 },
        },
      }),
    );
    expect(d.action).toBe("park_for_review");
    expect(d.reasonCodes).toEqual(["below_completeness_threshold"]);
  });

  it("a score exactly at the threshold passes", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        assessment: { ...a, completeness: { ...a.completeness, score: 60 } },
      }),
    );
    expect(d.action).toBe("auto_file");
  });

  it("review-required facts hold for the deadline", () => {
    const d = deriveCaseAutomationDecision(input({ reviewRequiredCount: 1 }));
    expect(d.action).toBe("hold_for_deadline");
    expect(d.reasonCodes).toEqual(["review_required_present"]);
  });

  it("moderate holds for the deadline rather than filing early", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        assessment: { ...a, strength: { ...a.strength, overall: "moderate" } },
      }),
    );
    expect(d.action).toBe("hold_for_deadline");
    expect(d.reasonCodes).toEqual(["eligible"]);
  });

  it("a fully-credited case files even at moderate — a named branch, not an inherited one", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        assessment: { ...a, strength: { ...a.strength, overall: "moderate" } },
        gates: {
          coverageState: null,
          fatalLoss: null,
          creditAlreadyIssued: { triggered: true, coversDisputedAmount: true },
        },
      }),
    );
    expect(d.action).toBe("auto_file");
  });

  it("automation mode can NEVER turn a block into a non-block", () => {
    /**
     * The deadline cron relies on this: it evaluates the decision with
     * `automationMode: "auto"` because the deadline path consults only whether
     * the decision BLOCKS, and every blocking rung sits above the mode rung.
     * Asserted here rather than left as a comment in that route, because a
     * future reordering of the ladder would otherwise break it silently and
     * the failure mode is "a covered or fatally-lost case gets filed".
     */
    const a = CONTRACT_FIXTURES[0].assessment;
    const variants: Array<Partial<CaseAutomationDecisionInput>> = [
      { gates: COVERED },
      { gates: FATAL },
      { assessmentFreshness: { fresh: false, reason: "input_hash_mismatch" } },
      {
        assessment: {
          ...a,
          completeness: { ...a.completeness, readiness: "blocked", blockers: ["x"] },
        },
      },
      { assessment: { ...a, strength: { ...a.strength, overall: "weak" } } },
      { assessment: { ...a, strength: { ...a.strength, overall: "insufficient" } } },
      {},
      { assessment: { ...a, completeness: { ...a.completeness, score: 10 } } },
      { assessment: { ...a, strength: { ...a.strength, overall: "moderate" } } },
    ];
    for (const [i, variant] of variants.entries()) {
      const asAuto = deriveCaseAutomationDecision(
        input({ ...variant, automationMode: "auto" }),
      );
      for (const mode of ["review", null] as const) {
        const other = deriveCaseAutomationDecision(
          input({ ...variant, automationMode: mode }),
        );
        expect(other.action === "block", `variant ${i} / mode ${mode}`).toBe(
          asAuto.action === "block",
        );
      }
    }
  });

  it("reason codes are never empty and never English", () => {
    for (const fixture of CONTRACT_FIXTURES) {
      const d = deriveCaseAutomationDecision(
        input({ assessment: fixture.assessment, caseId: fixture.name }),
      );
      expect(d.reasonCodes.length, fixture.name).toBeGreaterThan(0);
      for (const code of d.reasonCodes) {
        expect(code, fixture.name).toMatch(/^[a-z_]+$/);
      }
    }
  });
});

describe("the shared fixtures — action agreement", () => {
  /**
   * The nine coordinator-owned fixtures, replayed through the derivation.
   *
   * ACTIONS must agree. REASON CODES agree for every case the assessment alone
   * can explain. Two do not, and both are honest divergences rather than bugs:
   *
   *   review_required_safe      the fixture reasons from the argument PLAN's
   *                             excluded facts. Automation cannot see the plan
   *                             (branch boundary), so the count is supplied as
   *                             an input here — which reproduces the fixture.
   *   review_required_no_safe   the fixture names `review_required_present`;
   *                             the derivation names `strength_insufficient`,
   *                             because that case is ALSO weak and the strength
   *                             floor is decisive first. Same action (block),
   *                             same selection outcome. Reported to the
   *                             coordinator.
   */
  const reviewCounts: Record<string, number> = {
    review_required_safe_argument: 1,
    review_required_no_safe_argument: 1,
  };

  for (const fixture of CONTRACT_FIXTURES) {
    it(`${fixture.name} — action matches the fixture decision`, () => {
      const d = deriveCaseAutomationDecision(
        input({
          caseId: fixture.assessment.caseId,
          assessment: fixture.assessment,
          assessmentFreshness:
            fixture.name === "stale"
              ? { fresh: false, reason: "input_hash_mismatch" }
              : { fresh: true },
          gates:
            fixture.name === "covered_conceded"
              ? COVERED
              : { coverageState: null, fatalLoss: null, creditAlreadyIssued: null },
          reviewRequiredCount: reviewCounts[fixture.name] ?? 0,
        }),
      );
      expect(d.action).toBe(fixture.decision.action);
    });
  }

  it("reason codes match for every fixture the assessment alone explains", () => {
    const derivable = CONTRACT_FIXTURES.filter(
      (f) => f.name !== "review_required_no_safe_argument",
    );
    for (const fixture of derivable) {
      const d = deriveCaseAutomationDecision(
        input({
          caseId: fixture.assessment.caseId,
          assessment: fixture.assessment,
          assessmentFreshness:
            fixture.name === "stale"
              ? { fresh: false, reason: "input_hash_mismatch" }
              : { fresh: true },
          gates:
            fixture.name === "covered_conceded"
              ? COVERED
              : { coverageState: null, fatalLoss: null, creditAlreadyIssued: null },
          reviewRequiredCount: reviewCounts[fixture.name] ?? 0,
        }),
      );
      expect(d.reasonCodes, fixture.name).toEqual(fixture.decision.reasonCodes);
    }
  });
});

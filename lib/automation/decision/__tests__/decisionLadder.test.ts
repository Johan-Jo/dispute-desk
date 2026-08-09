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
import type { GateDecision } from "@/lib/pipeline/contracts";
import { CONTRACT_FIXTURES, FIXTURE_DUE_AT } from "@/lib/pipeline/contracts/__fixtures__/cases";
import {
  deriveCaseAutomationDecision,
  gateDecisionFromFacts,
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
    gates: { creditAlreadyIssued: null },
    evidenceDueAt: FIXTURE_DUE_AT,
    computedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

/*
 * CONTRACT REVISION 1. Coverage and fatal-loss used to be two loose values on
 * `AutomationGateFacts`; they are now ONE named `gateDecision` on the
 * assessment, because a boolean/pair could not say WHICH gate fired and the two
 * are not interchangeable. These helpers moved with them — the assertions below
 * are unchanged in substance, only in where the gate is stated.
 *
 * `gateDecisionFromFacts` is exercised separately (`heldState`, the pack-row
 * loader); here the named decision is set directly, which is what the ladder
 * actually reads.
 */
function withGate(
  assessment: CaseAutomationDecisionInput["assessment"],
  gateDecision: GateDecision,
): CaseAutomationDecisionInput["assessment"] {
  return { ...assessment, gateDecision };
}

const BASE = CONTRACT_FIXTURES[0].assessment;
const COVERED_ASSESSMENT = withGate(BASE, "coverage");
const FATAL_ASSESSMENT = withGate(BASE, "fatal_loss");
const NO_GATES = { creditAlreadyIssued: null } as const;

describe("Coverage Gate — preserved", () => {
  it("a covered case blocks and names coverage_active", () => {
    const d = deriveCaseAutomationDecision(input({ assessment: COVERED_ASSESSMENT }));
    expect(d.action).toBe("block");
    expect(d.reasonCodes).toEqual(["coverage_active"]);
  });

  it("coverage BEATS fatal-loss", () => {
    // Precedence now lives in `gateDecisionFromFacts` — the single projection
    // both the pack-row loader and `resolveHeldState` go through — so it is
    // asserted there, on the two raw values, rather than on a pair the ladder
    // no longer receives.
    expect(
      gateDecisionFromFacts({
        coverageState: "covered_shopify",
        fatalLoss: { triggered: true },
      }),
    ).toBe("coverage");
    const d = deriveCaseAutomationDecision(input({ assessment: COVERED_ASSESSMENT }));
    expect(d.reasonCodes).toEqual(["coverage_active"]);
  });

  it("a covered case is NEVER auto-filed, at any strength or completeness", () => {
    for (const overall of ["strong", "moderate", "weak", "insufficient"] as const) {
      const a = COVERED_ASSESSMENT;
      const d = deriveCaseAutomationDecision(
        input({
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
      // Asserted at the projection, which is where the literal now lives.
      expect(gateDecisionFromFacts({ coverageState: state, fatalLoss: null }), state).not.toBe(
        "coverage",
      );
      const d = deriveCaseAutomationDecision(
        input({
          assessment: withGate(
            BASE,
            gateDecisionFromFacts({ coverageState: state, fatalLoss: null }),
          ),
        }),
      );
      expect(d.reasonCodes, state).not.toContain("coverage_active");
    }
  });
});

describe("Fatal-loss Gate — preserved", () => {
  it("auto mode BLOCKS on a fatal-loss trigger", () => {
    const d = deriveCaseAutomationDecision(input({ assessment: FATAL_ASSESSMENT }));
    expect(d.action).toBe("block");
    expect(d.reasonCodes).toEqual(["fatal_loss"]);
  });

  it("blocks even on a strong, complete case", () => {
    const a = FATAL_ASSESSMENT;
    const d = deriveCaseAutomationDecision(
      input({
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
    // Revision 1 STRENGTHENS this property rather than weakening it: the
    // trigger string is no longer even an input to the decision — the
    // assessment carries the named gate and nothing else — so there is no
    // longer a path by which `refund_issued` could reach the snapshot.
    expect(
      gateDecisionFromFacts({
        coverageState: null,
        fatalLoss: { triggered: true },
      }),
    ).toBe("fatal_loss");
    const d = deriveCaseAutomationDecision(input({ assessment: FATAL_ASSESSMENT }));
    expect(JSON.stringify(d)).not.toContain("refund_issued");
    expect(d.reasonCodes).toEqual(["fatal_loss"]);
  });

  it("an untriggered fatal_loss object does not block", () => {
    expect(
      gateDecisionFromFacts({ coverageState: null, fatalLoss: { triggered: false } }),
    ).toBeNull();
    const d = deriveCaseAutomationDecision(input({ assessment: withGate(BASE, null) }));
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

  it("weak and insufficient HOLD before completeness is consulted — they never block", () => {
    /*
     * CONTRACT REVISION 2 — the assertion this test used to make was
     * `action === "block"`, and that was the defect, not the fix.
     *
     * Strength is an ODDS judgement and odds may never withhold a filing.
     * Filing nothing does not buy silence: Shopify auto-compiles and files its
     * own scrape, there is no accept/concede mutation, and VDMP/VAMP count
     * disputes RECEIVED, so losing a representment costs nothing. A guard
     * therefore chooses OUR DOCUMENT vs SHOPIFY'S SCRAPE, never submit vs
     * stay silent.
     *
     * What is preserved verbatim: the rung's POSITION (strength is still
     * consulted before completeness — score 5 here would otherwise park with
     * `below_completeness_threshold`) and its reason code.
     */
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
      expect(d.action, overall).toBe("hold_for_deadline");
      expect(d.reasonCodes, overall).toEqual(["strength_insufficient"]);
    }
  });

  it("no strength band, at any completeness, can produce a block", () => {
    /*
     * The revision-2 invariant stated as a property rather than as three cases:
     * a hard block is an HONESTY condition — coverage, fatal-loss, staleness or
     * a readiness hard block — and STRENGTH is never one of them. Written this
     * way so that reintroducing a strength-based block anywhere in the ladder
     * fails here even if the case above is edited.
     */
    const a = CONTRACT_FIXTURES[0].assessment;
    for (const overall of ["strong", "moderate", "weak", "insufficient"] as const) {
      for (const score of [0, 5, 59, 60, 100]) {
        const d = deriveCaseAutomationDecision(
          input({
            assessment: {
              ...a,
              gateDecision: null,
              strength: { ...a.strength, overall },
              completeness: { ...a.completeness, score, readiness: "ready", blockers: [] },
            },
          }),
        );
        expect(d.action, `${overall}/${score}`).not.toBe("block");
      }
    }
  });

  it("a weak case that also carries a review item names BOTH, most-decisive first", () => {
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({
        assessment: {
          ...a,
          strength: { ...a.strength, overall: "weak" },
          reviewRequiredCount: 1,
        },
      }),
    );
    expect(d.action).toBe("hold_for_deadline");
    expect(d.reasonCodes).toEqual(["strength_insufficient", "review_required_present"]);
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
    // Revision 1: the count moved from a decision INPUT onto the assessment,
    // so automation can observe the state it is allowed to name without
    // reaching across the branch boundary into the argument plan.
    const a = CONTRACT_FIXTURES[0].assessment;
    const d = deriveCaseAutomationDecision(
      input({ assessment: { ...a, reviewRequiredCount: 1 } }),
    );
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
        gates: { creditAlreadyIssued: { triggered: true, coversDisputedAmount: true } },
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
      { assessment: COVERED_ASSESSMENT },
      { assessment: FATAL_ASSESSMENT },
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
   * WHAT REVISIONS 1 AND 2 CHANGED HERE. Both of the divergences this block
   * used to carry are GONE, and neither was closed by relaxing an assertion:
   *
   *   review_required_safe      needed the count as a hand-supplied input,
   *                             because automation may not read the argument
   *                             plan. Revision 1 put `reviewRequiredCount` on
   *                             the assessment, so the fixture now carries it
   *                             and no test-local map is needed.
   *   review_required_no_safe   derived `strength_insufficient` where the
   *                             fixture said `review_required_present`.
   *                             Revision 2 made the fixture name BOTH, ordered
   *                             most-decisive first — which is what the ladder
   *                             produces. REASON CODES NOW AGREE FOR ALL NINE,
   *                             so the exclusion that used to sit on this
   *                             assertion has been deleted rather than widened.
   *
   * ONE DIVERGENCE REMAINS, and it is a CONTRACT question, not a defect in the
   * derivation — reported to the coordinator as a revision-3 candidate:
   *
   *   review_required_no_safe   fixture `decision.action` is `"block"`. The
   *                             derivation says `hold_for_deadline`.
   *
   * The fixture's block is the honest OUTCOME of that case, but it is owned by
   * the SELECTION layer, not this one: what makes it unfileable is
   * `plan.noSafeArgument`, and automation may not read the plan (branch
   * boundary). Everything automation CAN see about the case — weak strength, an
   * outstanding review item — is, post-revision-2, a hold rather than a block,
   * because a hard block is an honesty condition and strength is never one.
   * The `"block"` on the fixture is residue from the pre-revision-2 reading in
   * which weak strength blocked.
   *
   * Nothing downstream is affected, which is why this is a vocabulary question
   * and not a behaviour one: the fixture's `expected` outcome — `none` /
   * `no_safe_argument` on BOTH triggers — is asserted unchanged by
   * `selectFileablePackage.test.ts` and `executionAdapters.test.ts`, and it is
   * reached through the plan's `noSafeArgument`, which the selector consults
   * before it ever looks at the decision. That is asserted below rather than
   * asserted about.
   */
  const ACTION_DIVERGES = new Set(["review_required_no_safe_argument"]);

  function derive(fixture: (typeof CONTRACT_FIXTURES)[number]) {
    return deriveCaseAutomationDecision(
      input({
        caseId: fixture.assessment.caseId,
        assessment: fixture.assessment,
        assessmentFreshness:
          fixture.name === "stale"
            ? { fresh: false, reason: "input_hash_mismatch" }
            : { fresh: true },
        gates: NO_GATES,
      }),
    );
  }

  for (const fixture of CONTRACT_FIXTURES) {
    if (ACTION_DIVERGES.has(fixture.name)) continue;
    it(`${fixture.name} — action matches the fixture decision`, () => {
      expect(derive(fixture).action).toBe(fixture.decision.action);
    });
  }

  it("review_required_no_safe_argument — holds, and the PLAN is what makes it unfileable", () => {
    const fixture = CONTRACT_FIXTURES.find(
      (f) => f.name === "review_required_no_safe_argument",
    )!;
    // Pinned positively so the divergence is a stated claim rather than a gap.
    expect(derive(fixture).action).toBe("hold_for_deadline");
    expect(fixture.plan.noSafeArgument).not.toBeNull();
    expect(fixture.expected.deadline).toBe("none");
    expect(fixture.expected.deadlineReason).toBe("no_safe_argument");
  });

  it("reason codes match for EVERY fixture — no exclusions", () => {
    for (const fixture of CONTRACT_FIXTURES) {
      expect(derive(fixture).reasonCodes, fixture.name).toEqual(
        fixture.decision.reasonCodes,
      );
    }
  });
});

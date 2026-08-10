/**
 * P-6, and the safety property the contract test states across all nine
 * fixtures: the deadline trigger may differ from the normal trigger ONLY on
 * `deadline_only_not_yet_due` — never on a hard block, coverage, staleness or a
 * missing safe argument.
 *
 * A deadline relaxes NOTHING. Each of the SIX conjunctive conditions
 * (`noUnsupportedArgument` is contract revision 1's sixth) is flipped
 * independently below and each one on its own stops the filing.
 */

import { describe, expect, it } from "vitest";
import {
  CONTRACT_FIXTURES,
  FIXTURE_DUE_AT,
  FIXTURE_STRONG,
} from "@/lib/pipeline/contracts/__fixtures__/cases";
import type {
  CaseAutomationDecisionSnapshot,
  FileableSelection,
  SelectionTrigger,
} from "@/lib/pipeline/contracts";
import {
  notFileableReasonFor,
  selectForDeadline,
  selectForNormalExecution,
  type FileableSelectorPort,
} from "../executionAdapters";

const IN_WINDOW = new Date(FIXTURE_DUE_AT);
const BEFORE_WINDOW = new Date("2026-08-01T09:00:00.000Z");
const AFTER_WINDOW = new Date("2026-09-01T09:00:00.000Z");

function selected(trigger: SelectionTrigger): FileableSelection {
  return {
    outcome: "selected",
    trigger,
    package: { packageId: "pkg-1", packageVersion: 3, artifactId: "art-1" },
  };
}

/** A selector that always finds one current validated safe package. */
const alwaysSelects: FileableSelectorPort = {
  select: async ({ trigger }) => selected(trigger),
};

function portReturning(build: (t: SelectionTrigger) => FileableSelection): FileableSelectorPort {
  return { select: async ({ trigger }) => build(trigger) };
}

function decision(
  overrides: Partial<CaseAutomationDecisionSnapshot> = {},
): CaseAutomationDecisionSnapshot {
  return { ...FIXTURE_STRONG.decision, ...overrides };
}

describe("normal trigger", () => {
  it("files when the decision says auto_file and a package is selected", async () => {
    const s = await selectForNormalExecution({
      decision: decision({ action: "auto_file" }),
      selector: alwaysSelects,
    });
    expect(s.outcome).toBe("selected");
  });

  it("declines with deadline_only_not_yet_due on hold_for_deadline", async () => {
    const s = await selectForNormalExecution({
      decision: decision({ action: "hold_for_deadline" }),
      selector: alwaysSelects,
    });
    expect(s).toMatchObject({ outcome: "none", reason: "deadline_only_not_yet_due" });
  });

  it("declines with deadline_only_not_yet_due on park_for_review", async () => {
    const s = await selectForNormalExecution({
      decision: decision({ action: "park_for_review" }),
      selector: alwaysSelects,
    });
    expect(s).toMatchObject({ outcome: "none", reason: "deadline_only_not_yet_due" });
  });

  it("a decision block vetoes a selector that offered a package", async () => {
    const s = await selectForNormalExecution({
      decision: decision({ action: "block", reasonCodes: ["hard_block"] }),
      selector: alwaysSelects,
    });
    expect(s).toMatchObject({ outcome: "none", reason: "hard_block" });
  });

  it("the selector's own refusal is preferred — it knows reasons automation cannot", async () => {
    const s = await selectForNormalExecution({
      decision: decision({ action: "auto_file" }),
      selector: portReturning((trigger) => ({
        outcome: "none",
        trigger,
        reason: "no_safe_argument",
      })),
    });
    expect(s).toMatchObject({ outcome: "none", reason: "no_safe_argument" });
  });

  it("ambiguity is never silently resolved", async () => {
    const s = await selectForNormalExecution({
      decision: decision({ action: "auto_file" }),
      selector: portReturning((trigger) => ({
        outcome: "ambiguous",
        trigger,
        candidateIds: ["a", "b"],
      })),
    });
    expect(s.outcome).toBe("ambiguous");
  });
});

describe("deadline trigger — P-6, six conjunctive conditions", () => {
  const base = {
    decision: decision({ action: "hold_for_deadline" }),
    decisionFreshness: { fresh: true } as const,
    selector: alwaysSelects,
    caseId: "strong",
    now: IN_WINDOW,
  };

  it("all six hold → files", async () => {
    /*
     * CONTRACT REVISION 1 added `noUnsupportedArgument` as a SIXTH field,
     * un-folded from `hasCurrentValidatedSafePackage`. P-6's prose names six
     * conditions and this object had five, so a reviewer counting them against
     * the decision could not find them one-to-one — which is the one check this
     * object exists to make easy.
     *
     * `toEqual` on the whole object rather than field-by-field assertions is
     * load-bearing: `mayExecuteAtDeadline` folds over `Object.values`, so a
     * seventh condition added to the interface and forgotten here would
     * otherwise pass silently.
     */
    const out = await selectForDeadline(base);
    expect(out.selection.outcome).toBe("selected");
    expect(out.conditions).toEqual({
      hasCurrentCanonicalDecision: true,
      hasCurrentValidatedSafePackage: true,
      noHardBlock: true,
      notStale: true,
      noAmbiguity: true,
      noUnsupportedArgument: true,
    });
  });

  it("no canonical decision → files nothing", async () => {
    const out = await selectForDeadline({ ...base, decision: null });
    expect(out.selection.outcome).toBe("none");
    expect(out.conditions.hasCurrentCanonicalDecision).toBe(false);
  });

  it("a superseded decision → files nothing, and says which freshness rule failed", async () => {
    const out = await selectForDeadline({
      ...base,
      decisionFreshness: { fresh: false, reason: "policy_version_superseded" },
    });
    expect(out.selection).toMatchObject({
      outcome: "none",
      reason: "stale",
      staleness: "policy_version_superseded",
    });
    expect(out.conditions.notStale).toBe(false);
  });

  it("no current validated safe package → files nothing", async () => {
    const out = await selectForDeadline({
      ...base,
      selector: portReturning((trigger) => ({
        outcome: "none",
        trigger,
        reason: "validation_failed",
      })),
    });
    expect(out.selection).toMatchObject({ outcome: "none", reason: "validation_failed" });
    expect(out.conditions.hasCurrentValidatedSafePackage).toBe(false);
  });

  it("a hard block is NOT relaxed by the deadline", async () => {
    const out = await selectForDeadline({
      ...base,
      decision: decision({ action: "block", reasonCodes: ["hard_block"] }),
    });
    expect(out.selection).toMatchObject({ outcome: "none", reason: "hard_block" });
    expect(out.conditions.noHardBlock).toBe(false);
  });

  it("a STALE package is not relaxed by the deadline", async () => {
    const out = await selectForDeadline({
      ...base,
      selector: portReturning((trigger) => ({
        outcome: "none",
        trigger,
        reason: "stale",
        staleness: "input_hash_mismatch",
      })),
    });
    expect(out.selection).toMatchObject({ outcome: "none", reason: "stale" });
    expect(out.conditions.notStale).toBe(false);
  });

  it("ambiguity is not relaxed by the deadline — it alerts, it never picks", async () => {
    const out = await selectForDeadline({
      ...base,
      selector: portReturning((trigger) => ({
        outcome: "ambiguous",
        trigger,
        candidateIds: ["v3", "v4"],
      })),
    });
    expect(out.selection.outcome).toBe("ambiguous");
    expect(out.conditions.noAmbiguity).toBe(false);
  });

  it("an unsupported argument is not relaxed by the deadline", async () => {
    const out = await selectForDeadline({
      ...base,
      selector: portReturning((trigger) => ({
        outcome: "none",
        trigger,
        reason: "no_safe_argument",
      })),
    });
    expect(out.selection).toMatchObject({ outcome: "none", reason: "no_safe_argument" });
  });

  it("coverage is not relaxed by the deadline", async () => {
    const out = await selectForDeadline({
      ...base,
      decision: decision({ action: "block", reasonCodes: ["coverage_active"] }),
    });
    expect(out.selection).toMatchObject({
      outcome: "none",
      reason: "coverage_or_concession",
    });
  });
});

describe("deadline trigger — the window is computed at execution", () => {
  const base = {
    decision: decision({ action: "hold_for_deadline" }),
    decisionFreshness: { fresh: true } as const,
    selector: alwaysSelects,
    caseId: "strong",
  };

  it("before the due day: nothing files", async () => {
    const out = await selectForDeadline({ ...base, now: BEFORE_WINDOW });
    expect(out.window).toBe("before_window");
    expect(out.selection).toMatchObject({
      outcome: "none",
      reason: "deadline_only_not_yet_due",
    });
  });

  it("on the due day: files", async () => {
    const out = await selectForDeadline({ ...base, now: IN_WINDOW });
    expect(out.window).toBe("in_window");
    expect(out.selection.outcome).toBe("selected");
  });

  it("after the due day: nothing files", async () => {
    const out = await selectForDeadline({ ...base, now: AFTER_WINDOW });
    expect(out.window).toBe("past_window");
    expect(out.selection.outcome).toBe("none");
  });

  it("no due date at all: nothing files", async () => {
    const out = await selectForDeadline({
      ...base,
      decision: decision({ action: "hold_for_deadline", evidenceDueAt: null }),
      now: IN_WINDOW,
    });
    expect(out.window).toBe("unknown");
    expect(out.selection.outcome).toBe("none");
  });
});

describe("the safety property, across all nine shared fixtures", () => {
  /**
   * The deadline trigger may differ from the normal trigger ONLY on
   * `deadline_only_not_yet_due`. Everything else — hard block, coverage,
   * staleness, no safe argument — must produce the same refusal on both.
   *
   * The selector is stubbed to the fixture's own expectation, which is exactly
   * the acceptance contract Agent B implements against.
   */
  for (const fixture of CONTRACT_FIXTURES) {
    it(fixture.name, async () => {
      const port = portReturning((trigger): FileableSelection => {
        const expected = trigger === "normal" ? fixture.expected.normal : fixture.expected.deadline;
        const reason =
          trigger === "normal" ? fixture.expected.normalReason : fixture.expected.deadlineReason;
        if (expected === "selected") return selected(trigger);
        if (expected === "ambiguous") {
          return { outcome: "ambiguous", trigger, candidateIds: ["a", "b"] };
        }
        return { outcome: "none", trigger, reason: reason ?? "no_package" };
      });

      const isStale = fixture.name === "stale";
      const freshness = isStale
        ? ({ fresh: false, reason: "input_hash_mismatch" } as const)
        : ({ fresh: true } as const);

      const normal = await selectForNormalExecution({
        decision: fixture.decision,
        selector: port,
      });
      const deadline = await selectForDeadline({
        decision: fixture.decision,
        decisionFreshness: freshness,
        selector: port,
        caseId: fixture.decision.caseId,
        now: IN_WINDOW,
      });

      expect(normal.outcome, `${fixture.name} normal`).toBe(fixture.expected.normal);
      expect(deadline.selection.outcome, `${fixture.name} deadline`).toBe(
        fixture.expected.deadline,
      );

      if (normal.outcome === "none" && deadline.selection.outcome === "none") {
        // Where both decline, the only permitted difference is the normal
        // trigger deferring to the deadline.
        if (normal.reason !== deadline.selection.reason) {
          expect(normal.reason).toBe("deadline_only_not_yet_due");
        }
      }
      if (deadline.selection.outcome === "selected") {
        // A deadline may only ADD a filing over the normal trigger when the
        // normal trigger's sole objection was that it was not yet due.
        expect(
          normal.outcome === "selected" ||
            (normal.outcome === "none" && normal.reason === "deadline_only_not_yet_due"),
          fixture.name,
        ).toBe(true);
      }
    });
  }
});

describe("block-reason mapping", () => {
  it("maps each decision block onto the selection vocabulary", () => {
    expect(notFileableReasonFor(decision({ reasonCodes: ["coverage_active"] }))).toBe(
      "coverage_or_concession",
    );
    expect(notFileableReasonFor(decision({ reasonCodes: ["assessment_stale"] }))).toBe("stale");
    expect(notFileableReasonFor(decision({ reasonCodes: ["fatal_loss"] }))).toBe("hard_block");
    expect(notFileableReasonFor(decision({ reasonCodes: ["hard_block"] }))).toBe("hard_block");
    expect(notFileableReasonFor(decision({ reasonCodes: ["strength_insufficient"] }))).toBe(
      "hard_block",
    );
  });
});

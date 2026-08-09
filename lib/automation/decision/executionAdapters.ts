/**
 * The two execution adapters: `normal` and `deadline`.
 *
 * PACKAGE CHOICE IS NOT IN THE DECISION. The persisted decision says what
 * automation may do; it never names a package. Executors ask a selector for a
 * `FileableSelection` at execution time, so a decision stored yesterday can
 * never authorise filing a package that was superseded since. No executor may
 * reach a fileable row directly — the port below is the only way in.
 *
 * ORDER OF EVALUATION, and it is deliberate. The selector is consulted FIRST,
 * then the decision vetoes. Two reasons:
 *
 *   1. The selector owns the reasons automation is not allowed to know. A case
 *      whose argument collapses once its `review_required` facts are excluded
 *      is `no_safe_argument`, and that fact lives in the argument plan, which
 *      automation may not import (branch boundary). Reporting `hard_block`
 *      there would be true-ish and useless.
 *   2. Safety is unaffected, because the veto is applied to `selected` and only
 *      ever downgrades it. There is no path on which a decision block yields a
 *      filing.
 *
 * P-6 lives in `selectForDeadline`, expressed through the shared
 * `mayExecuteAtDeadline` — five conditions, conjunctive, and a deadline relaxes
 * NONE of them.
 */

import {
  isFileable,
  mayExecuteAtDeadline,
  type CaseAutomationDecisionSnapshot,
  type DeadlineExecutionConditions,
  type FileableSelection,
  type FreshnessVerdict,
  type NotFileableReason,
  type SelectionTrigger,
  type StalenessReason,
} from "@/lib/pipeline/contracts";
import { resolveDeadlineWindow, type DeadlineWindowState } from "./deadlineWindow";

/**
 * The one way an executor obtains a package.
 *
 * Agent B ships the implementation; CP-C depends only on this shape so the
 * branch can be built, tested and reviewed before that implementation exists.
 * The coordinator wires the real selector at integration.
 */
export interface FileableSelectorPort {
  select(args: {
    caseId: string;
    trigger: SelectionTrigger;
  }): Promise<FileableSelection>;
}

/** Map a decision's block reason onto the selection vocabulary. */
export function notFileableReasonFor(
  decision: CaseAutomationDecisionSnapshot,
): NotFileableReason {
  const head = decision.reasonCodes[0];
  switch (head) {
    case "coverage_active":
      return "coverage_or_concession";
    case "assessment_stale":
      return "stale";
    // fatal_loss, hard_block, strength_insufficient and anything else that
    // reaches `block` are all "this case may not be filed at all". They stay
    // distinguishable through `decision.reasonCodes`, which travels with the
    // audit row; collapsing them here keeps the SELECTION vocabulary closed.
    default:
      return "hard_block";
  }
}

function none(
  trigger: SelectionTrigger,
  reason: NotFileableReason,
  staleness?: StalenessReason,
): FileableSelection {
  return staleness
    ? { outcome: "none", trigger, reason, staleness }
    : { outcome: "none", trigger, reason };
}

/**
 * NORMAL trigger. Files only when the decision says `auto_file`; every other
 * action either blocks outright or declines with `deadline_only_not_yet_due`,
 * which is not a failure — it is the normal trigger correctly leaving a case to
 * the deadline trigger.
 */
export async function selectForNormalExecution(args: {
  decision: CaseAutomationDecisionSnapshot;
  selector: FileableSelectorPort;
}): Promise<FileableSelection> {
  const { decision, selector } = args;
  const selection = await selector.select({
    caseId: decision.caseId,
    trigger: "normal",
  });

  // The selector already declined, and it knows reasons automation does not.
  if (!isFileable(selection)) return selection;

  if (decision.action === "block") {
    return none("normal", notFileableReasonFor(decision));
  }
  if (decision.action !== "auto_file") {
    return none("normal", "deadline_only_not_yet_due");
  }
  return selection;
}

export interface DeadlineExecutionOutcome {
  selection: FileableSelection;
  /**
   * Which of P-6's conditions held. Carried out of the adapter so a refusal can
   * NAME the failing condition: an executor that can only say "not allowed"
   * produces exactly the un-diagnosable filing behaviour this replaces.
   */
  conditions: DeadlineExecutionConditions;
  window: DeadlineWindowState;
}

/**
 * DEADLINE trigger — P-6, exactly.
 *
 * Allowed only with a current canonical decision AND a current validated safe
 * package, with no hard block, no staleness, no ambiguity and no unsupported
 * argument. The last of those is carried by the selector: a case with no safe
 * rebuttal comes back `none / no_safe_argument`, which fails
 * `hasCurrentValidatedSafePackage` before `mayExecuteAtDeadline` is even
 * consulted.
 *
 * The window is computed HERE, from the decision's absolute due date and the
 * `now` the caller passes — never read off the decision.
 */
export async function selectForDeadline(args: {
  decision: CaseAutomationDecisionSnapshot | null;
  /** Freshness of `decision`, from the ONE shared predicate. */
  decisionFreshness: FreshnessVerdict;
  selector: FileableSelectorPort;
  caseId: string;
  now: Date;
}): Promise<DeadlineExecutionOutcome> {
  const { decision, decisionFreshness, selector, caseId, now } = args;

  const window = resolveDeadlineWindow(decision?.evidenceDueAt ?? null, now);

  // A decision that is absent or superseded is not a decision. Nothing is
  // filed, and no selector call is made: asking for a package we could not
  // authorise anyway only risks acting on the answer.
  if (!decision || !decisionFreshness.fresh) {
    const conditions: DeadlineExecutionConditions = {
      hasCurrentCanonicalDecision: false,
      hasCurrentValidatedSafePackage: false,
      noHardBlock: decision ? decision.action !== "block" : false,
      notStale: decisionFreshness.fresh,
      noAmbiguity: true,
    };
    const staleness = decisionFreshness.fresh ? undefined : decisionFreshness.reason;
    return {
      selection: none(
        "deadline",
        decision ? "stale" : "no_package",
        staleness,
      ),
      conditions,
      window: window.state,
    };
  }

  if (window.state !== "in_window") {
    // Not this case's day. Not a refusal of the case — a refusal of the moment.
    return {
      selection: none("deadline", "deadline_only_not_yet_due"),
      conditions: {
        hasCurrentCanonicalDecision: true,
        hasCurrentValidatedSafePackage: false,
        noHardBlock: decision.action !== "block",
        notStale: true,
        noAmbiguity: true,
      },
      window: window.state,
    };
  }

  const selection = await selector.select({ caseId, trigger: "deadline" });

  const conditions: DeadlineExecutionConditions = {
    hasCurrentCanonicalDecision: true,
    hasCurrentValidatedSafePackage: isFileable(selection),
    noHardBlock: decision.action !== "block",
    notStale:
      decisionFreshness.fresh &&
      !(selection.outcome === "none" && selection.reason === "stale"),
    noAmbiguity: selection.outcome !== "ambiguous",
  };

  if (mayExecuteAtDeadline(conditions)) {
    return { selection, conditions, window: window.state };
  }

  // Refused. Prefer the selector's own reason when it already declined — it is
  // strictly more specific than anything the decision can say.
  if (!isFileable(selection)) {
    return { selection, conditions, window: window.state };
  }
  return {
    selection: none("deadline", notFileableReasonFor(decision)),
    conditions,
    window: window.state,
  };
}

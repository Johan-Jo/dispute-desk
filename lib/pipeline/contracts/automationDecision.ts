/**
 * `CaseAutomationDecision` — what automation does, independent of what the
 * argument says.
 *
 * THE BRANCH BOUNDARY. This layer derives from `CaseAssessment`, rules and
 * settings, and the dispute's ABSOLUTE due date. It may not import argument-plan
 * or review internals, and package choice is deliberately absent: executors
 * receive a `FileableSelection` at execution time. Automation asking "what does
 * the letter say" is how a decision starts depending on prose.
 *
 * TIME-INVARIANCE — the invariant, stated so it cannot be read two ways:
 *
 *   The decision may carry the ABSOLUTE evidence due date. It may never carry,
 *   or be derived from, a RELATIVE time state — time remaining, window
 *   open/closed, days to deadline. Executors compute window state from the
 *   absolute due date at execution.
 *
 * Pinned by test: identical inputs evaluated at two different clock times must
 * produce an identical `inputHash` AND identical `reasonCodes`. A due-date
 * change is an input change and MUST change the hash.
 *
 * WHY IT MATTERS. Today the deadline cron — the actual submitter — consults no
 * strength, no completeness, no coverage and no guards (R3). Making it consult
 * this object is P-6, and P-6's decision is conjunctive: five conditions, all
 * of them, or nothing is filed.
 */

import type { SnapshotFreshness } from "./freshness";

export type AutomationAction =
  | "auto_file"
  | "park_for_review"
  | "hold_for_deadline"
  | "block";

/**
 * Stable machine codes. Never English, never merchant copy — the UI resolves
 * them through i18n, and the same code must mean the same thing at every entry
 * point (that identity is the whole reason this layer exists).
 */
export type AutomationReasonCode =
  | "coverage_active"
  | "fatal_loss"
  | "returned_to_sender"
  | "hard_block"
  | "below_completeness_threshold"
  | "strength_insufficient"
  | "review_required_present"
  | "assessment_stale"
  | "automation_disabled"
  | "eligible";

export interface CaseAutomationDecisionSnapshot {
  caseId: string;
  decisionVersion: number;
  action: AutomationAction;
  /** Ordered most-decisive first. Never empty. */
  reasonCodes: AutomationReasonCode[];
  /**
   * ISO-8601 absolute instant. NOT a duration, NOT a window flag.
   * See the time-invariance rule above.
   */
  evidenceDueAt: string | null;
  freshness: SnapshotFreshness;
}

/**
 * P-6, encoded. All five must hold before the deadline path may file.
 *
 * Written as an explicit object rather than a boolean so a failure names which
 * condition failed — an executor that can only say "not allowed" produces
 * exactly the un-diagnosable filing behaviour this replaces.
 */
export interface DeadlineExecutionConditions {
  hasCurrentCanonicalDecision: boolean;
  hasCurrentValidatedSafePackage: boolean;
  noHardBlock: boolean;
  notStale: boolean;
  noAmbiguity: boolean;
  /**
   * Revision 1, Agent C's friction 3: P-6's prose names six things and the
   * first cut of this interface had five fields, with "no unsupported argument"
   * folded into `hasCurrentValidatedSafePackage`. A reviewer counting
   * conditions against the decision could not find them one-to-one, which is
   * precisely the check this object exists to make easy. Now it is 1:1.
   */
  noUnsupportedArgument: boolean;
}

/**
 * Conjunctive by construction. A deadline relaxes none of these.
 *
 * Written over `Object.values` rather than a hand-listed `&&` chain so that
 * adding a condition to the interface cannot silently leave it unchecked.
 */
export function mayExecuteAtDeadline(c: DeadlineExecutionConditions): boolean {
  return Object.values(c).every(Boolean);
}

/**
 * `FileableSelection` — the one answer to "what, if anything, may be filed".
 *
 * THREE OUTCOMES, AND THE THIRD IS THE POINT.
 *
 *   selected — exactly one current, validated package.
 *   none     — a TYPED reason. Not null, not false, not an empty array.
 *   ambiguous— two or more candidates and no rule that picks between them.
 *              This is an ERROR that alerts, never a silent choice.
 *
 * `ambiguous` exists because the alternative — "take the newest" — is how a
 * superseded package reaches an issuer. If the selector cannot name one
 * package, filing stops and a human is told.
 *
 * WHAT THIS SUBSUMES. `packageSafety` (C-11, in production since 2026-08-08) is
 * already consulted at the save job, the manual save route, the deadline cron's
 * candidate selection and the workspace readiness projection. The selector
 * REPLACES those call sites; it does not sit beside them. Measured behaviour to
 * preserve: 212 of 280 package versions blocked, matching the pre-release
 * census exactly. A different count on the same population is a defect until
 * explained.
 */

import type { StalenessReason } from "./freshness";

export type SelectionTrigger = "normal" | "deadline";

/**
 * Every way "nothing may be filed" can be true, enumerated.
 *
 * Enumerated rather than free-text because each one routes differently in the
 * UI and in alerting, and because a reviewer must be able to prove the list is
 * exhaustive. `deadline_only_not_yet_due` is not a failure — it is the normal
 * trigger correctly declining a package the deadline trigger may later take.
 */
export type NotFileableReason =
  | "no_package"
  | "no_safe_argument"
  | "validation_failed"
  | "hard_block"
  | "coverage_or_concession"
  | "stale"
  | "artifact_missing"
  | "superseded"
  | "deadline_only_not_yet_due";

export interface SelectedPackage {
  packageId: string;
  packageVersion: number;
  /** The generated artifact this selection stands behind. Never inferred. */
  artifactId: string;
}

export type FileableSelection =
  | { outcome: "selected"; trigger: SelectionTrigger; package: SelectedPackage }
  | {
      outcome: "none";
      trigger: SelectionTrigger;
      reason: NotFileableReason;
      /** Present only when `reason === "stale"`; says which freshness rule failed. */
      staleness?: StalenessReason;
    }
  | {
      outcome: "ambiguous";
      trigger: SelectionTrigger;
      /** Every candidate, so the alert can show what the selector saw. */
      candidateIds: string[];
    };

/** Narrowing helper so no consumer re-implements the check with a string compare. */
export function isFileable(
  selection: FileableSelection,
): selection is Extract<FileableSelection, { outcome: "selected" }> {
  return selection.outcome === "selected";
}

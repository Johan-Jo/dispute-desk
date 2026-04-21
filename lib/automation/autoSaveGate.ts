/**
 * Auto-save gate: checks whether a pack meets the quality criteria to be
 * pushed to Shopify. Called from the pipeline ONLY after the per-family
 * rule has said auto_pack — the rule is the source of truth for whether
 * to automate; this gate only verifies the pack is fit for submission.
 *
 * Review-vs-automate is NOT a concern of this function; the old
 * `require_review_before_save` flag was removed because it silently
 * overrode the Rules page and made auto rules non-functional.
 */

import type { SubmissionReadiness } from "@/lib/types/evidenceItem";

export type GateDecision =
  | { action: "auto_save" }
  | { action: "block"; reasons: string[] };

interface GateInput {
  autoSaveEnabled: boolean;
  autoSaveMinScore: number;
  enforceNoBlockers: boolean;
  completenessScore: number;
  blockers: string[];
  /** V2: when present, uses readiness instead of blockers for gating. */
  submissionReadiness?: SubmissionReadiness;
}

export function evaluateAutoSaveGate(input: GateInput): GateDecision {
  const reasons: string[] = [];

  if (!input.autoSaveEnabled) {
    reasons.push("Auto-save is disabled for this store");
  }

  if (input.completenessScore < input.autoSaveMinScore) {
    reasons.push(
      `Completeness score ${input.completenessScore}% is below threshold ${input.autoSaveMinScore}%`
    );
  }

  // V2 readiness-aware: only hard-block when readiness is "blocked"
  // (not for "ready_with_warnings"). Falls back to legacy blocker count
  // when readiness is not provided.
  if (input.enforceNoBlockers) {
    if (input.submissionReadiness !== undefined) {
      if (input.submissionReadiness === "blocked") {
        reasons.push("Submission is blocked — required evidence missing");
      }
    } else if (input.blockers.length > 0) {
      reasons.push(
        `${input.blockers.length} blocker(s) remain: ${input.blockers.join(", ")}`
      );
    }
  }

  if (reasons.length > 0) {
    return { action: "block", reasons };
  }
  return { action: "auto_save" };
}

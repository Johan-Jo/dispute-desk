/**
 * "Why This Case Should Win" — strengths/weaknesses summary.
 *
 * Post-retirement (2026-05-16): the argument-map iterator that
 * surfaced per-counterclaim strengths/weaknesses was deleted along
 * with the legacy bank-rebuttal engine. The headline strength now
 * comes solely from `caseStrength.calculateCaseStrength` (canonical
 * registry path). This function returns empty strength/weakness
 * arrays so existing callers keep compiling; the UI now reads from
 * `caseStrength.computeContributions` for the row-level breakdown.
 *
 * Kept as a tiny shim instead of deleted to avoid churning the four
 * call sites in the embedded workspace hook + tests; a follow-up can
 * remove this file once those callers stop importing it.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { WhyWinsResult, CaseStrengthLevel } from "./types";

export function generateWhyWins(
  _checklist: ChecklistItemV2[],
  weightedStrength?: CaseStrengthLevel,
): WhyWinsResult {
  return {
    strengths: [],
    weaknesses: [],
    overall: weightedStrength ?? "insufficient",
  };
}

/**
 * Risk explanation for the Review & Submit tab.
 *
 * Post-retirement (2026-05-16): the per-counterclaim missing-evidence
 * iterator was deleted with the legacy argument map. Risks now derive
 * purely from missing checklist items; the workspace hook can compose
 * a list from `derived.contributions` instead.
 *
 * Kept as a thin shim so existing callers keep compiling. Returns an
 * empty risks list when no map is available — a follow-up can swap
 * callers to read from `caseStrength.computeContributions`.
 */

import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { CaseStrengthLevel, RiskResult } from "./types";

export function generateRiskExplanation(
  _checklist: ChecklistItemV2[],
  expectedOutcome: CaseStrengthLevel = "insufficient",
): RiskResult {
  return { expectedOutcome, risks: [] };
}

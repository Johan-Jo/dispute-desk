/**
 * Evidence-strength resolver — a thin pass-through of the rules engine.
 *
 * The grade comes exclusively from `caseStrength.overall`
 * (lib/argument/caseStrength.ts). The presentation layer NEVER
 * re-derives or reclassifies strength.
 *
 * `overall === "insufficient"` is the engine's true pre-assessment
 * value (empty checklist — caseStrength.ts:360-364) and maps to
 * `not_assessed`, distinct from `weak`. Never key off `heroVariant`
 * for this distinction: `insufficient` and `weak` both collapse to
 * `hard_to_win` (caseStrength.ts:784).
 */

import type { EvidenceStrength } from "./types";

export function resolveStrength(
  overall: string | null | undefined,
): EvidenceStrength {
  switch (overall) {
    case "strong":
      return "strong";
    case "moderate":
      return "moderate";
    case "weak":
      return "weak";
    default:
      // "insufficient", null, undefined, or unknown → no assessment yet.
      return "not_assessed";
  }
}

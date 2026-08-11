/**
 * CP-A — the workspace assessment PAYLOAD SHAPE, and its empty form.
 *
 * Split out of `workspaceAssessment.ts` for exactly one reason: that module
 * imports the scorer, and the hook that renders this payload runs in the
 * BROWSER. If the client imported the builder to reach its type, the scorer
 * would be back in the client bundle — one `import` away from being called
 * again, which is the whole defect this epic removes. Types and the empty
 * value are safe to share; the derivation is not.
 *
 * Everything here is either a type or a constant. No scoring, no i18n
 * resolution, no English.
 */

import type { CaseStrengthResult, ImprovementSignal } from "@/lib/argument/types";
import type { CaseStrengthContributions } from "@/lib/argument/caseStrength";
import type { SubmissionReadiness } from "@/lib/types/evidenceItem";
import type { MerchantAssessmentProjection, StalenessReason } from "@/lib/pipeline/contracts";
import {
  deadlineFilingCopy,
  type DeadlineFilingCopy,
  type DeadlineFilingState,
} from "./deadlineOnlyCopy";

/**
 * Everything the three tabs need in order to render strength, completeness
 * and filing state WITHOUT computing any of it.
 *
 * Deliberately a flat, closed payload. If a tab needs a number that is not
 * here, the answer is to add it here — never to ship the checklist and let
 * the tab work it out, which is how the browser acquired a scorer.
 */
export interface WorkspaceAssessmentPayload {
  /** The scorer's full result. Computed once, server-side, with real gates. */
  caseStrength: CaseStrengthResult;
  /** Band / score / readiness / review items, or `needsRecalculation`. */
  assessment: MerchantAssessmentProjection;
  /** `deadline_only` vs `withheld_no_safe_argument`, in tokens. */
  filing: DeadlineFilingCopy & { state: DeadlineFilingState };
  /** Submission readiness AS RENDERED — includes the `submitted` terminal. */
  readiness: SubmissionReadiness;
  blockerCount: number;
  warningCount: number;
  /** Critical, non-blocking gaps the merchant may override past. */
  submitOverrideGaps: Array<{ field: string; label: string }>;
  /** "What supports your case" rows. Was a hand-copy in two places. */
  contributions: CaseStrengthContributions;
  /** The single highest-value missing signal, or null. */
  improvement: ImprovementSignal | null;
}

/**
 * The `needsRecalculation` payload.
 *
 * Returned when the route holds no pack — and the shape a caller should use
 * rather than inventing a zeroed `CaseStrengthResult` of its own, which is
 * how "insufficient · 0%" came to be rendered as if it were a verdict.
 *
 * `caseStrength` is still a real object because the tabs type against it, but
 * every consumer must branch on `assessment.needsRecalculation` FIRST. The
 * band inside is `insufficient`, which is the scorer's own "nothing to
 * assess" value and not a judgement about this case.
 */
export function emptyWorkspaceAssessment(
  disputeId: string,
  reason: StalenessReason = "snapshot_absent",
): WorkspaceAssessmentPayload {
  const filingState: DeadlineFilingState = { kind: "normal" };
  return {
    caseStrength: {
      overall: "insufficient",
      score: 0,
      coveragePercent: 0,
      strongCount: 0,
      moderateCount: 0,
      supportingCount: 0,
      supportedClaims: 0,
      totalClaims: 0,
      improvementHintI18n: null,
      strengthReasonI18n: { key: "disputes.strengthReason.general.insufficient" },
      heroVariant: "hard_to_win",
    },
    assessment: {
      caseId: disputeId,
      needsRecalculation: true,
      strengthBand: null,
      completenessScore: null,
      readiness: null,
      reviewItems: [],
      recalculationReason: reason,
    },
    filing: { ...deadlineFilingCopy(filingState), state: filingState },
    readiness: "blocked",
    blockerCount: 0,
    warningCount: 0,
    submitOverrideGaps: [],
    contributions: { strong: [], moderate: [] },
    improvement: null,
  };
}

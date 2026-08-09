/**
 * CP-A — the workspace assessment payload, computed once on the server.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────
 *
 * `useDisputeWorkspace` used to call `calculateCaseStrength` in the BROWSER,
 * with a gate set it assembled itself, and separately reconstruct submission
 * readiness from the checklist. The server route computed its own answer from
 * a different gate set on the same request. On a fraud case with a cardholder-
 * name mismatch the two disagreed on one screen: the client showed Strong,
 * the server had capped Moderate (2026-08-05 audit).
 *
 * The fix is not "pass better gates to the client". It is that the client has
 * no scorer at all. This function is the single server-side derivation the
 * workspace API ships, and the hook renders it.
 *
 * ── WHO CALLS IT ──────────────────────────────────────────────────────
 *
 * `app/api/disputes/[id]/workspace/route.ts` — Agent C's file under the CP-0
 * ownership map. This module is a pure function so C can call it without
 * inheriting any of CP-A's internals. See the epic report for the exact call.
 *
 * Nothing here reads a database, a request, or a clock.
 */

import type { CaseGateAssessment } from "@/lib/argument/caseGateAssessment";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import { calculateImprovement, computeContributions } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2, SubmissionReadiness } from "@/lib/types/evidenceItem";
import { deriveAssessmentFromChecklists } from "@/lib/evidence/model/assessment";
import { completenessFromChecklist } from "@/lib/evidence/model/completenessSnapshot";
import { projectReviewItems } from "@/lib/evidence/model/merchantProjection";
import type { CaseArgumentPlanSnapshot, MerchantReviewItem } from "@/lib/pipeline/contracts";
import { deadlineFilingCopy, resolveDeadlineFilingState } from "./deadlineOnlyCopy";
import type { WorkspaceAssessmentPayload } from "./workspaceAssessmentTypes";

export type { WorkspaceAssessmentPayload } from "./workspaceAssessmentTypes";
export { emptyWorkspaceAssessment } from "./workspaceAssessmentTypes";

export interface WorkspaceAssessmentInput {
  disputeId: string;
  /** The reconciled `checklist_v2` the route already built. */
  checklist: ChecklistItemV2[];
  reason: string | null | undefined;
  payloadSource: EvidencePayloadSource | undefined;
  /** Built through `buildCaseGateAssessment` by the route. */
  gates: CaseGateAssessment;
  /**
   * Whether the evidence has already reached Shopify. Drives the `submitted`
   * terminal readiness, which is a LIFECYCLE fact and not a completeness one
   * — a submitted pack with gaps is still submitted.
   */
  packSaved: boolean;
  /** Layer 3, when it exists. Absent for cases with no plan yet. */
  plan?: CaseArgumentPlanSnapshot | null;
}

/**
 * Build the payload.
 *
 * READINESS IS DERIVED HERE ONCE, from `deriveCompletenessMetrics` via
 * `completenessFromChecklist`, with exactly one thing layered on top: the
 * `submitted` terminal. The browser used to compute the same three-way
 * blocked / ready_with_warnings / ready branch inline, which meant a change
 * to the readiness rule had to be made in two places or the page would
 * disagree with the gate that filed the evidence.
 */
export function buildWorkspaceAssessment(
  input: WorkspaceAssessmentInput,
): WorkspaceAssessmentPayload {
  const { checklist, reason, payloadSource, gates, packSaved, plan } = input;

  // One derivation, through the single entry point. `deriveAssessmentFrom
  // Checklists` is the only module allowed to call the scorer.
  const { strength } = deriveAssessmentFromChecklists({
    strengthChecklist: checklist,
    completenessChecklist: checklist,
    reason,
    payloadSource,
    gates,
  });
  const completeness = completenessFromChecklist(checklist);

  // `submitted` is a lifecycle terminal layered over the derived readiness,
  // never a fourth completeness outcome. A saved pack with critical gaps is
  // still saved, and telling the merchant "ready with warnings" about
  // evidence Shopify already holds is an instruction they cannot act on.
  const readiness: SubmissionReadiness = packSaved ? "submitted" : completeness.readiness;

  const blockerCount = checklist.filter(
    (c) => c.blocking && c.status === "missing",
  ).length;
  const criticalGaps = checklist.filter(
    (c) => c.priority === "critical" && !c.blocking && c.status === "missing",
  );

  const reviewItems: MerchantReviewItem[] = projectReviewItems(plan);
  const filingState = resolveDeadlineFilingState({
    deadlineOnly: plan?.deadlineOnly ?? false,
    noSafeArgument: plan?.noSafeArgument ?? null,
    reviewItemCount: reviewItems.length,
  });

  return {
    caseStrength: strength,
    // The workspace route computes the assessment from LIVE inputs on every
    // request, so by construction it cannot be stale against itself. The
    // projection is still built through the same function the persisted path
    // uses, so the two surfaces cannot describe one case two ways.
    assessment: {
      caseId: input.disputeId,
      needsRecalculation: false,
      strengthBand: strength.overall,
      completenessScore: completeness.score,
      readiness,
      reviewItems,
      recalculationReason: null,
    },
    filing: { ...deadlineFilingCopy(filingState), state: filingState },
    readiness,
    blockerCount,
    warningCount: criticalGaps.length,
    submitOverrideGaps: criticalGaps.map((c) => ({ field: c.field, label: c.label })),
    contributions: computeContributions({ checklist, payloadSource, reason }),
    improvement: calculateImprovement(checklist, reason, payloadSource),
  };
}


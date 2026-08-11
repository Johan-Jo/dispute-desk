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


import type { CaseStrengthResult } from "@/lib/argument/types";
import type { EvidencePayloadSource } from "@/lib/argument/caseStrength";
import { calculateImprovement, computeContributions } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2, SubmissionReadiness } from "@/lib/types/evidenceItem";
import { ASSESSMENT_POLICY_VERSION } from "@/lib/evidence/model/assessmentSnapshot";

import { projectMerchantAssessment } from "@/lib/evidence/model/merchantProjection";
import type {
  CaseArgumentPlanSnapshot,
  CaseAssessmentSnapshot,
  InputHash,
} from "@/lib/pipeline/contracts";
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
  /**
   * The PERSISTED snapshot, read from `pack_json.case_assessment`.
   *
   * Absent for a pack built before the writer existed. Absent is a state, not
   * a zero: it produces `needsRecalculation` and null verdict values.
   */
  snapshot: CaseAssessmentSnapshot | null;
  /**
   * The current input hash, reconstructed by the CALLER from live inputs
   * through `computeAssessmentInputHash`.
   *
   * `null` when the caller could not reconstruct one — a legacy pack with no
   * persisted gate fingerprint. That is `needsRecalculation` too: an
   * unverifiable snapshot is not a fresh one.
   *
   * Passed IN rather than computed here, and this module deliberately cannot
   * compute it: a function that both produces the hash and checks it against
   * the snapshot would be comparing the snapshot with itself, which is exactly
   * the check that detects nothing.
   */
  currentInputHash: InputHash | null;
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
 * Build the payload by PROJECTING the persisted snapshot.
 *
 * ── WHAT THIS NO LONGER DOES ──────────────────────────────────────────
 *
 * It used to call `deriveAssessmentFromChecklists` with the workspace route's
 * own gate set — a set in which three of five gates are unavailable, because
 * the route does not load the Shopify order. That is a second derivation with
 * strictly worse inputs, and it produced a second answer: on a fraud case with
 * a cardholder-name mismatch it showed one band while the build path had
 * capped another.
 *
 * Deleting the browser's scorer moved that defect one layer down rather than
 * removing it. The route now renders what `buildPack` — the only site holding
 * all five gates — persisted.
 *
 * ── WHAT IS STILL DERIVED, AND WHY IT IS SAFE ─────────────────────────
 *
 * `contributions` and `improvement` are display rows: "what supports your
 * case" and the single highest-value missing signal. They read the checklist
 * and produce LABELS. Neither returns a band, a score or a readiness, so
 * neither can re-band the case or reconstruct completeness — which is the line
 * that matters. `blockerCount` / `warningCount` / `submitOverrideGaps` are
 * likewise counts of checklist rows, not a readiness derivation.
 *
 * When the snapshot is absent or stale they are still computed but the payload
 * carries no verdict, and `assessmentPresence` stops every surface rendering
 * them as one.
 */
export function buildWorkspaceAssessment(
  input: WorkspaceAssessmentInput,
): WorkspaceAssessmentPayload {
  const { checklist, reason, payloadSource, packSaved, plan, snapshot } = input;

  /* THE projection. One owner for "is this snapshot current", shared with the
   * persisted path, so the two cannot answer differently. A null current hash
   * is passed through as a sentinel that can never equal a real one — the
   * snapshot is then unverifiable, and unverifiable is not fresh. */
  const projection = projectMerchantAssessment({
    caseId: input.disputeId,
    snapshot,
    currentInputHash: input.currentInputHash ?? UNRECONSTRUCTABLE_HASH,
    currentPolicyVersion: ASSESSMENT_POLICY_VERSION,
    plan,
  });

  const assessed = !projection.needsRecalculation && snapshot !== null;

  /* Strength comes from the SNAPSHOT, never from a fresh score.
   *
   * `EMPTY_WORKSPACE_STRENGTH` is the scorer's "nothing to assess" value and
   * is used only while `needsRecalculation` is true. Every surface branches on
   * the flag before reading it — `lib/disputes/assessmentPresence.ts` — and
   * `tests/unit/assessmentPresenceSurfaces.test.ts` fails if one stops. */
  const strength: CaseStrengthResult = assessed
    ? snapshot!.strength
    : EMPTY_WORKSPACE_STRENGTH;

  /* Readiness: the snapshot's, with the `submitted` lifecycle terminal layered
   * on top. Not recomputed from the checklist — that was the second
   * completeness derivation. With no current snapshot there is no readiness to
   * report, and `"blocked"` would be a verdict; the payload carries the
   * sentinel and the projection carries `null`. */
  const readiness: SubmissionReadiness = packSaved
    ? "submitted"
    : assessed
      ? (snapshot!.completeness.readiness ?? "blocked")
      : "blocked";

  const blockerCount = checklist.filter(
    (c) => c.blocking && c.status === "missing",
  ).length;
  const criticalGaps = checklist.filter(
    (c) => c.priority === "critical" && !c.blocking && c.status === "missing",
  );

  const filingState = resolveDeadlineFilingState({
    deadlineOnly: plan?.deadlineOnly ?? false,
    noSafeArgument: plan?.noSafeArgument ?? null,
    reviewItemCount: projection.reviewItems.length,
  });

  return {
    caseStrength: strength,
    assessment: {
      ...projection,
      // The lifecycle terminal is a rendering fact, not part of the snapshot.
      readiness: assessed ? readiness : projection.readiness,
    },
    filing: { ...deadlineFilingCopy(filingState), state: filingState },
    readiness,
    blockerCount,
    warningCount: criticalGaps.length,
    submitOverrideGaps: criticalGaps.map((c) => ({ field: c.field, label: c.label })),
    // DISPLAY ONLY. Labels, not a band; see the header.
    contributions: computeContributions({ checklist, payloadSource, reason }),
    improvement: calculateImprovement(checklist, reason, payloadSource),
  };
}

/**
 * A hash no real snapshot can carry.
 *
 * Used when the caller could not reconstruct the current hash at all. The
 * alternative — skipping the freshness check — would render an unverifiable
 * snapshot as current, which is the failure this layer exists to prevent.
 */
const UNRECONSTRUCTABLE_HASH = "unreconstructable" as InputHash;

/** The scorer's own "nothing to assess" value. Never a judgement about a case. */
const EMPTY_WORKSPACE_STRENGTH: CaseStrengthResult = {
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
};

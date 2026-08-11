/**
 * The ONE call an executor makes to obtain a package (CP-B §7, CP-C §6).
 *
 * ── WHY A SINGLE HELPER AND NOT THREE CALL SITES ──────────────────────
 *
 * Four executors need "may anything be filed for this case, and if so what":
 * the pack pipeline's auto-save branch, the promotion helper, the save worker
 * and the deadline cron. Each reached for a package its own way — two through
 * `preflightLatestCandidate`, one through a raw `order by version desc limit
 * 1`, one through the placeholder selector — and each judged it against a
 * slightly different set of columns. That is the divergence this delivery
 * exists to end, and leaving four callers to assemble the same three snapshots
 * would just move the divergence into the assembly.
 *
 * So: build the decision, build the context, ask the selector, hand back the
 * verdict plus the exact row it judged.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────
 *
 * No disposition. It returns a `FileableSelection`; how a refusal maps onto
 * "park for review" versus "defer" versus "fail the job" is each executor's
 * own product decision, and those genuinely differ — the pipeline parks a
 * merchant-actionable refusal and defers a transient one, the worker fails
 * non-retriably, the cron emails. Collapsing them here would be a fifth
 * opinion about the same verdict.
 *
 * ── NORMAL vs DEADLINE ────────────────────────────────────────────────
 *
 * The `normal` trigger goes through `selectForNormalExecution`, so the
 * decision's veto applies on top of the selection: a case whose argument is
 * fine but whose decision says `hold_for_deadline` declines here with
 * `deadline_only_not_yet_due` — not a failure, the normal trigger correctly
 * leaving the case to the deadline trigger. The `deadline` trigger belongs to
 * `selectForDeadline` and its six P-6 conditions; the cron calls that directly
 * because it also needs the conditions object for its audit row.
 */

import type { getServiceClient } from "@/lib/supabase/server";
import type {
  CaseAutomationDecisionSnapshot,
  FileableSelection,
} from "@/lib/pipeline/contracts";
import { decideForPack, selectForNormalExecution } from "@/lib/automation/decision";
import {
  buildFileableSelectionContext,
  type SelectionContextPackRow,
} from "./caseSelectionContext";
import {
  createCanonicalSelector,
  type JudgedCandidate,
} from "./loadFileableSelection";

type ServiceClient = ReturnType<typeof getServiceClient>;

export interface ExecutorSelectionArgs {
  sb: ServiceClient;
  caseId: string;
  pack: SelectionContextPackRow;
  settings: {
    auto_save_enabled: boolean;
    auto_save_min_score: number | null | undefined;
    enforce_no_blockers: boolean;
  };
  automationMode: "auto" | "review" | null;
  /** `disputes.due_at` — ABSOLUTE. Executors compute the window, never this. */
  evidenceDueAt: string | null;
  disputeReason: string | null;
  networkReasonCode: string | null;
}

export interface ExecutorSelection {
  selection: FileableSelection;
  /** The decision the selection was judged against. Carried for the audit row. */
  decision: CaseAutomationDecisionSnapshot;
  /** The highest-version row the selector inspected, or null on a tie. */
  judged: JudgedCandidate | null;
  /**
   * Whether that row failed the C-11 CONTENT verdict specifically.
   *
   * `validation_failed` covers both an unsafe claim and a failed document
   * validation, correctly — but the audit event and the merchant copy
   * distinguish them, and the unsafe claim is the one a merchant can act on.
   */
  unsafeContent: boolean;
}

export async function selectForNormalExecutor(
  args: ExecutorSelectionArgs,
): Promise<ExecutorSelection> {
  const decision = decideForPack({
    caseId: args.caseId,
    pack: {
      id: args.pack.id,
      dispute_id: args.pack.dispute_id,
      completeness_score: args.pack.completeness_score,
      blockers: args.pack.blockers,
      submission_readiness: args.pack.submission_readiness,
      pack_json: args.pack.pack_json,
    },
    settings: args.settings,
    automationMode: args.automationMode,
    evidenceDueAt: args.evidenceDueAt,
  });

  const context = await buildFileableSelectionContext({
    sb: args.sb,
    caseId: args.caseId,
    pack: args.pack,
    decision,
    disputeReason: args.disputeReason,
    networkReasonCode: args.networkReasonCode,
    reasonCodeModuleKey: null,
  });

  const selector = createCanonicalSelector({
    sb: args.sb,
    contextFor: () => context,
  });

  const selection = await selectForNormalExecution({ decision, selector });

  return {
    selection,
    decision,
    judged: selector.judgedFor(args.caseId),
    unsafeContent: selector.unsafeContentFor(args.caseId),
  };
}

/**
 * The SAVE WORKER's selection.
 *
 * ── WHY IT DOES NOT USE THE NORMAL ADAPTER ────────────────────────────
 *
 * `selectForNormalExecution` applies the decision's veto on top of the
 * selection, and one of its outcomes is `deadline_only_not_yet_due` — the
 * normal trigger correctly leaving a case to the deadline trigger. The worker
 * is downstream of BOTH triggers: the job it is running may have been enqueued
 * by the deadline cron, whose whole purpose is that the moment has arrived.
 * Re-applying the normal veto here would make the worker refuse a save the
 * deadline path legitimately authorised, at the deadline, which is the one
 * moment a refusal cannot be retried.
 *
 * So it asks with the `deadline` trigger. That relaxes EXACTLY ONE rung —
 * `deadline_only_not_yet_due` — and nothing else: coverage/concession, a hard
 * block, staleness, an absent safe argument, a failed content or document
 * validation, ambiguity, a superseded row and a missing artifact all still
 * refuse. P-6's "a deadline relaxes nothing" is about those; it was never about
 * the rung that exists to defer to the deadline.
 *
 * What the worker is confirming is narrow and worth stating: the package it is
 * about to file is still the current, validated, safe one. Not whether
 * automation may act — that was decided when the job was enqueued.
 */
export async function selectForSaveWorker(
  args: ExecutorSelectionArgs,
): Promise<ExecutorSelection> {
  const decision = decideForPack({
    caseId: args.caseId,
    pack: {
      id: args.pack.id,
      dispute_id: args.pack.dispute_id,
      completeness_score: args.pack.completeness_score,
      blockers: args.pack.blockers,
      submission_readiness: args.pack.submission_readiness,
      pack_json: args.pack.pack_json,
    },
    settings: args.settings,
    automationMode: args.automationMode,
    evidenceDueAt: args.evidenceDueAt,
  });

  const context = await buildFileableSelectionContext({
    sb: args.sb,
    caseId: args.caseId,
    pack: args.pack,
    decision,
    disputeReason: args.disputeReason,
    networkReasonCode: args.networkReasonCode,
    reasonCodeModuleKey: null,
  });

  const selector = createCanonicalSelector({
    sb: args.sb,
    contextFor: () => context,
  });

  const selection = await selector.select({
    caseId: args.caseId,
    trigger: "deadline",
  });

  return {
    selection,
    decision,
    judged: selector.judgedFor(args.caseId),
    unsafeContent: selector.unsafeContentFor(args.caseId),
  };
}

/**
 * Reasons a refusal is the MERCHANT'S to act on.
 *
 * Everything else — an absent package, a transient read failure — is a
 * deferral: the post-build path picks the case up once a validated package
 * exists, and raising a review-required banner for it would ask the merchant to
 * fix something that is not theirs and not yet wrong.
 */
const MERCHANT_ACTIONABLE = new Set([
  "validation_failed",
  "no_safe_argument",
  "superseded",
  "not_final",
  "artifact_missing",
  "stale",
]);

export function selectionIsMerchantActionable(
  selection: FileableSelection,
): boolean {
  if (selection.outcome === "ambiguous") return false;
  if (selection.outcome === "selected") return false;
  return MERCHANT_ACTIONABLE.has(selection.reason);
}

/** A refusal that means "nothing to file YET", not "something is wrong". */
export function selectionIsPending(selection: FileableSelection): boolean {
  return selection.outcome === "none" && selection.reason === "no_package";
}

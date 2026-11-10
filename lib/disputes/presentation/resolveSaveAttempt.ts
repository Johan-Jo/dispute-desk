/**
 * LATEST SAVE ATTEMPT — what happened on the most recent attempt to file the
 * defence package to Shopify.
 *
 * Sibling of `resolveBuildAttempt` (which answers the same question for the
 * BUILD). Spec: docs/plans/dispute-page-single-source.plan.md §6 Track S.
 *
 * Why it exists. `evidence_packs.status = 'saved_to_shopify'` used to be
 * stamped when the save job was ENQUEUED, before Shopify accepted anything
 * (whj8db-1q #23750 showed "saved" for nine days while Shopify rejected every
 * upload). A pack status alone therefore never proves a save. The proof is
 * `disputes.submission_state`, which only the save handler writes on success.
 *
 * Objective facts only: no attention, no strength, no merchant preference.
 */

export type SaveAttemptState =
  /** Nothing has been attempted (or the pack is not at a save rung). */
  | "none"
  /** A save job is waiting to run, or the pack is stamped `saving`. */
  | "queued"
  /** A save job is running now. */
  | "running"
  /** The last attempt ended without Shopify accepting the evidence. */
  | "failed"
  /** Shopify accepted the evidence (`submission_state` says so). */
  | "saved"
  /** The pack is stamped saved but `submission_state` records no save: the
   *  legacy enqueue-time stamp. Not a save, and not a failure we recorded. */
  | "stamped_unconfirmed";

export interface ResolveSaveAttemptInput {
  /** Latest `evidence_packs.status`, or null when no pack exists. */
  packStatus: string | null;
  /** `disputes.submission_state`. */
  submissionState: string | null;
  /**
   * An active `save_to_shopify` job (`jobs.status` queued/running/pending) for
   * the latest pack. The deadline cron's RPC enqueues a save without touching
   * pack status, so the job is the only evidence for that path. `null` = the
   * caller did not read jobs.
   */
  activeJobStatus?: string | null;
}

const SAVED_SUBMISSION_STATES = new Set(["saved_to_shopify", "submitted_confirmed"]);
const SAVED_PACK_STATUSES = new Set([
  "saved_to_shopify",
  "saved_to_shopify_unverified",
  "saved_to_shopify_verified",
]);

export function resolveSaveAttempt(input: ResolveSaveAttemptInput): SaveAttemptState {
  // A job in flight outranks every settled fact: work is happening now.
  if (input.activeJobStatus === "running") return "running";
  if (input.activeJobStatus === "queued" || input.activeJobStatus === "pending") {
    return "queued";
  }

  const savedByRecord =
    input.submissionState != null && SAVED_SUBMISSION_STATES.has(input.submissionState);
  if (savedByRecord) return "saved";

  const status = input.packStatus;
  if (status === "saving") return "queued";
  if (status === "save_failed") return "failed";
  if (status != null && SAVED_PACK_STATUSES.has(status)) return "stamped_unconfirmed";
  return "none";
}

/** States that license "DisputeDesk is filing it" copy. */
export function isSaveInFlight(state: SaveAttemptState): boolean {
  return state === "queued" || state === "running";
}

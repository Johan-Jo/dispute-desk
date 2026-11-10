/**
 * Terminal-state bookkeeping for the save_to_shopify handler (Track S).
 *
 * Every return from the handler after it has started goes through
 * `settleSaveFailure` (or is a success/skip that already wrote a saved
 * status). Before this existed only the auth/GraphQL/userErrors paths touched
 * the pack: a PDF download, upload or size failure returned `retriable` and
 * left whatever the enqueue had stamped — which was `saved_to_shopify`. #23750
 * showed "saved" for nine days while Shopify rejected every upload with 422.
 *
 * Rules:
 *  - FINAL = non-retriable, OR the job has used its last attempt
 *    (`claimJobs` increments `attempts` at claim, so `attempts >= maxAttempts`
 *    means no retry follows — same test as `markJobFailed`).
 *  - FINAL  -> pack `save_failed`, dispute `attention_reason =
 *    'submission_failed'` (never over a blocking reason already there), one
 *    admin email per dispute per day.
 *  - not final -> pack `saving`: a retry is coming, and the pack must not read
 *    as saved or as prepared in the meantime.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";
import { sendSaveFailedAdminAlert } from "@/lib/email/sendSaveFailedAdminAlert";
import type { ClaimedJob, JobResult } from "../claimJobs";

export interface SaveFailureArgs {
  sb: SupabaseClient;
  job: ClaimedJob;
  packId: string;
  shopId: string;
  disputeId: string | null;
  /** Short machine class written to the audit row and the admin email. */
  errorClass: string;
  /** Human/ops-readable reason; becomes `JobResult.reason`. */
  reason: string;
  retriable: boolean;
  /** Extra audit payload keys (e.g. `user_errors`, `size_bytes`). */
  extra?: Record<string, unknown>;
}

/** Rolling window for the once-per-dispute admin email. */
const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isFinalFailure(job: ClaimedJob, retriable: boolean): boolean {
  return !retriable || job.attempts >= job.maxAttempts;
}

export async function settleSaveFailure(args: SaveFailureArgs): Promise<JobResult> {
  const { sb, job, packId, shopId, disputeId, errorClass, reason, retriable } = args;
  const final = isFinalFailure(job, retriable);
  const now = new Date().toISOString();

  await sb
    .from("evidence_packs")
    .update({ status: final ? "save_failed" : "saving", updated_at: now })
    .eq("id", packId);

  await logAuditEvent({
    shopId,
    disputeId,
    packId,
    actorType: "system",
    eventType: "job_failed",
    eventPayload: {
      jobId: job.id,
      jobType: "save_to_shopify",
      reason: errorClass,
      error_class: errorClass,
      error: reason.slice(0, 500),
      retriable,
      final,
      attempt: job.attempts,
      max_attempts: job.maxAttempts,
      ...args.extra,
    },
  });

  if (final && disputeId) {
    try {
      await markSubmissionFailed(sb, { job, packId, shopId, disputeId, errorClass, reason });
    } catch (err) {
      // Bookkeeping must never change the result the worker acts on.
      console.error("[saveToShopify] failed to record submission_failed", err);
    }
  }

  return { ok: false, retriable: final ? false : retriable, reason };
}

async function markSubmissionFailed(
  sb: SupabaseClient,
  a: {
    job: ClaimedJob;
    packId: string;
    shopId: string;
    disputeId: string;
    errorClass: string;
    reason: string;
  },
): Promise<void> {
  // Never over another reason: a billing or bank-claim task keeps its banner.
  await sb
    .from("disputes")
    .update({
      needs_attention: true,
      attention_reason: DISPUTE_ATTENTION_REASONS.SUBMISSION_FAILED,
      attention_payload: {
        pack_id: a.packId,
        job_id: a.job.id,
        last_error: a.reason.slice(0, 500),
        error_class: a.errorClass,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", a.disputeId)
    .or(
      `attention_reason.is.null,attention_reason.eq.${DISPUTE_ATTENTION_REASONS.SUBMISSION_FAILED}`,
    );

  await alertAdminOncePerDay(sb, a);
}

async function alertAdminOncePerDay(
  sb: SupabaseClient,
  a: {
    job: ClaimedJob;
    packId: string;
    shopId: string;
    disputeId: string;
    errorClass: string;
    reason: string;
  },
): Promise<void> {
  const since = new Date(Date.now() - ALERT_WINDOW_MS).toISOString();
  const { data: recent } = await sb
    .from("audit_events")
    .select("id")
    .eq("dispute_id", a.disputeId)
    .eq("event_type", "save_failed_admin_alerted")
    .gte("created_at", since)
    .limit(1);
  if ((recent ?? []).length > 0) return;

  // Record first: a duplicate email is worse than a missed one, and the
  // deadline cron and a manual retry can both end here within the same hour.
  await logAuditEvent({
    shopId: a.shopId,
    disputeId: a.disputeId,
    packId: a.packId,
    actorType: "system",
    eventType: "save_failed_admin_alerted",
    eventPayload: { jobId: a.job.id, error_class: a.errorClass },
  });

  const { data: dispute } = await sb
    .from("disputes")
    .select("order_name, due_at")
    .eq("id", a.disputeId)
    .maybeSingle();
  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain")
    .eq("id", a.shopId)
    .maybeSingle();

  await sendSaveFailedAdminAlert({
    shopDomain: (shop?.shop_domain as string | undefined) ?? null,
    orderName: (dispute?.order_name as string | null | undefined) ?? null,
    disputeId: a.disputeId,
    packId: a.packId,
    dueAt: (dispute?.due_at as string | null | undefined) ?? null,
    errorClass: a.errorClass,
    reason: a.reason,
    attempt: a.job.attempts,
    maxAttempts: a.job.maxAttempts,
  });
}

/**
 * A save succeeded: the failure banner, if it is OURS, goes away. Only
 * `submission_failed` is cleared — never another reason.
 */
export async function clearSubmissionFailed(
  sb: SupabaseClient,
  disputeId: string,
): Promise<void> {
  const { error } = await sb
    .from("disputes")
    .update({
      needs_attention: false,
      attention_reason: null,
      attention_payload: {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", disputeId)
    .eq("attention_reason", DISPUTE_ATTENTION_REASONS.SUBMISSION_FAILED);
  if (error) {
    console.error("[saveToShopify] failed to clear submission_failed", {
      disputeId,
      message: error.message,
    });
  }
}

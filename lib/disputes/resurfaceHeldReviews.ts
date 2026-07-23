/**
 * Resurface stale "held for review" disputes near their deadline.
 *
 * A merchant who chose "hold & watch" (`review_state = 'in_review'`) is
 * actively working the dispute — but if they never come back, that hold
 * would silently ride all the way to the deadline and the dispute would
 * be auto-submitted (or expire) without a fresh look. This sweep, run by
 * the daily `dispute-reminders` cron, catches held disputes inside a
 * threshold window of their `review_due_at` and flips them back to
 * needs_attention so they re-appear in the actionable queue with a clear
 * "deadline approaching" reason.
 *
 * Runs as a SEPARATE query from the reminder-email scan because that scan
 * filters `reminder_sent_at IS NULL` — a held dispute may already have
 * been reminded, yet still needs resurfacing. Idempotent: once flipped,
 * `review_state` is no longer 'in_review', so the next run skips it.
 *
 * (2026-07-23 review lifecycle; lib/disputes/reviewState.ts.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";

/** How close to the review deadline a held dispute must be before it is
 *  resurfaced. Matches the reminder window (48h) so a held dispute
 *  surfaces on the same cadence as a never-touched one. */
export const RESURFACE_WINDOW_HOURS = 48;

export interface ResurfaceResult {
  scanned: number;
  resurfaced: number;
}

/**
 * Flip `in_review` disputes within RESURFACE_WINDOW_HOURS of their
 * `review_due_at` back to needs_attention. Returns counts for the cron
 * summary. Never throws on a per-row failure — logs via audit and
 * continues so one bad row can't stall the sweep.
 */
export async function resurfaceHeldReviews(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<ResurfaceResult> {
  const cutoff = new Date(
    now.getTime() + RESURFACE_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();

  // review_due_at <= cutoff catches disputes at/near their deadline.
  // The partial index idx_disputes_in_review_due backs this scan.
  const { data: held, error } = await sb
    .from("disputes")
    .select("id, shop_id, review_due_at, due_at")
    .eq("review_state", "in_review")
    .not("review_due_at", "is", null)
    .lte("review_due_at", cutoff);

  if (error || !held?.length) {
    return { scanned: held?.length ?? 0, resurfaced: 0 };
  }

  let resurfaced = 0;
  for (const d of held) {
    const dueAt: string | null = d.review_due_at ?? d.due_at ?? null;
    const hoursToDeadline = dueAt
      ? Math.round((new Date(dueAt).getTime() - now.getTime()) / 3_600_000)
      : null;

    const { error: updErr } = await sb
      .from("disputes")
      .update({
        needs_attention: true,
        attention_reason: DISPUTE_ATTENTION_REASONS.REVIEW_DEADLINE_APPROACHING,
        attention_payload: { hours_to_deadline: hoursToDeadline, due_at: dueAt },
        // Clear the hold: the merchant's "I'm on it" is stale, so the
        // dispute returns to the undecided state and rides the shop's
        // automation rule at the deadline unless they act again.
        review_state: null,
        review_due_at: null,
        updated_at: now.toISOString(),
      })
      .eq("id", d.id)
      .eq("review_state", "in_review"); // guard against a concurrent action

    if (updErr) continue;

    resurfaced++;
    await logAuditEvent({
      shopId: d.shop_id,
      disputeId: d.id,
      actorType: "system",
      eventType: "review_resurfaced_by_reminder",
      eventPayload: { hours_to_deadline: hoursToDeadline },
    }).catch(() => {});
  }

  return { scanned: held.length, resurfaced };
}

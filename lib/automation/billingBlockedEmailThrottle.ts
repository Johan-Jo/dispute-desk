/**
 * Throttle helper for billing-blocked merchant emails.
 *
 * When the automation pipeline blocks a pack for a billing-shaped
 * reason (`quota_exceeded`, `feature_blocked`, `subscription_expired`,
 * `payment_failed`), the merchant needs to know — but not for every
 * dispute. A shop with five new disputes in an hour and a depleted
 * quota would otherwise get five identical "upgrade to keep building
 * packs" emails. The audit event and the in-app banner / timeline
 * event always fire; only the email is throttled.
 *
 * Throttle rule:
 *   1. Per-dispute: a single billing-blocked email per dispute, ever.
 *      If we already sent one for this dispute, skip.
 *   2. Per-shop + per-reason: 6-hour cooldown window. Inside the
 *      window, no further email for the same reason — unless the
 *      dispute's deadline is within the next 72 hours, in which case
 *      the email always sends.
 *
 * State of truth: `audit_events` rows with
 *   event_type = 'billing_blocked_email_sent',
 *   event_payload = { reason, dispute_id, dispute_due_at? }.
 *
 * The helper writes the audit row atomically with the "allowed"
 * decision so concurrent pipeline calls can't both claim the slot.
 *
 * IMPORTANT: never use this helper to silence in-app banners or
 * dispute timeline events. Those are merchant-visible at all times.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { DisputeAttentionReason } from "@/lib/disputes/attentionReasons";

/** 6-hour cooldown window for repeated same-reason billing emails. */
export const BILLING_BLOCKED_EMAIL_THROTTLE_HOURS = 6;

/** Emails always fire when the dispute deadline is within this window,
 *  even if the per-shop throttle would otherwise suppress. */
export const BILLING_BLOCKED_DEADLINE_OVERRIDE_HOURS = 72;

const EVENT_TYPE = "billing_blocked_email_sent";

export interface ClaimBillingBlockedEmailInput {
  shopId: string;
  disputeId: string;
  reason: DisputeAttentionReason;
  /** Dispute evidence deadline (`disputes.due_at`) when known. The
   *  72-hour deadline override only fires when this is non-null AND
   *  in the future. */
  disputeDueAt?: string | null;
}

export interface ClaimBillingBlockedEmailResult {
  /** When `true`, the caller MUST send the email — the slot was
   *  claimed and the audit row was written. When `false`, the caller
   *  MUST skip the email; the in-app banner + timeline event still
   *  apply. */
  allowed: boolean;
  /** Why the slot was denied (when applicable). Informational only;
   *  callers should not branch on the reason — `allowed` is the only
   *  contract. */
  reason?:
    | "already_sent_for_dispute"
    | "throttled_same_reason"
    | "throttle_failed_safe";
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function withinDeadlineOverride(disputeDueAt?: string | null): boolean {
  if (!disputeDueAt) return false;
  const dueMs = new Date(disputeDueAt).getTime();
  if (!Number.isFinite(dueMs)) return false;
  const overrideCutoffMs =
    Date.now() + BILLING_BLOCKED_DEADLINE_OVERRIDE_HOURS * 60 * 60 * 1000;
  return dueMs <= overrideCutoffMs && dueMs > Date.now();
}

/**
 * Decide whether to send the billing-blocked email for this dispute
 * AND, if so, claim the slot by writing the audit row. Idempotent
 * under retries — concurrent callers either both observe the same
 * "already-sent" state OR one wins the insert and the other reads
 * the new row on its next query.
 */
export async function claimBillingBlockedEmailSlot(
  input: ClaimBillingBlockedEmailInput,
): Promise<ClaimBillingBlockedEmailResult> {
  const sb = getServiceClient();
  const { shopId, disputeId, reason, disputeDueAt } = input;

  try {
    // Per-dispute guard: have we already sent this exact email?
    const { data: existingForDispute } = await sb
      .from("audit_events")
      .select("id")
      .eq("shop_id", shopId)
      .eq("dispute_id", disputeId)
      .eq("event_type", EVENT_TYPE)
      .limit(1)
      .maybeSingle();
    if (existingForDispute) {
      return { allowed: false, reason: "already_sent_for_dispute" };
    }

    // Deadline override: if the dispute is within 72h, always send.
    if (!withinDeadlineOverride(disputeDueAt)) {
      // Per-shop + per-reason guard: 6h cooldown.
      const cutoffIso = hoursAgoIso(BILLING_BLOCKED_EMAIL_THROTTLE_HOURS);
      const { data: recent } = await sb
        .from("audit_events")
        .select("id, event_payload")
        .eq("shop_id", shopId)
        .eq("event_type", EVENT_TYPE)
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(20);

      const sameReasonRecently = (recent ?? []).some((r) => {
        const payload = r.event_payload as { reason?: string } | null;
        return payload?.reason === reason;
      });

      if (sameReasonRecently) {
        return { allowed: false, reason: "throttled_same_reason" };
      }
    }

    await sb.from("audit_events").insert({
      shop_id: shopId,
      dispute_id: disputeId,
      actor_type: "system",
      event_type: EVENT_TYPE,
      event_payload: {
        reason,
        dispute_id: disputeId,
        dispute_due_at: disputeDueAt ?? null,
        deadline_override:
          withinDeadlineOverride(disputeDueAt) || undefined,
      },
    });

    return { allowed: true };
  } catch (err) {
    // Throttle infrastructure failure must NEVER block the merchant
    // from being notified about a billing issue. Fall open on the
    // first attempt; subsequent in-window attempts will be silenced
    // once the audit-events table is reachable again.
    console.warn(
      "[billingBlockedEmailThrottle] claim failed open:",
      err instanceof Error ? err.message : String(err),
    );
    return { allowed: true, reason: "throttle_failed_safe" };
  }
}

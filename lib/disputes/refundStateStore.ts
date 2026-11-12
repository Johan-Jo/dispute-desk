/**
 * Persistence for `dispute_refund_state`: one row per dispute holding the last interpreted refund state.
 * The interpretation is `lib/disputes/refundState.ts`; this file only stores it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefundState } from "@/lib/disputes/refundState";

export interface StoredRefundState {
  dispute_id: string;
  shop_id: string;
  order_gid: string;
  state: RefundState["kind"];
  unknown_reason: string | null;
  pending_amount: number;
  settled_amount: number;
  failed_amount: number;
  currency: string | null;
  first_refund_at: string | null;
  settled_at: string | null;
  stalled_pending: boolean;
  return_status: string | null;
  payment_gateways: string[];
  checked_at: string;
  last_changed_at: string;
  state_at_close: RefundState["kind"] | null;
  state_at_close_checked_at: string | null;
}

/** The columns written from a read; pure so the mapping is testable. */
export function refundStateRow(
  disputeId: string,
  shopId: string,
  orderGid: string,
  s: RefundState,
  now: string,
): Omit<StoredRefundState, "last_changed_at" | "state_at_close" | "state_at_close_checked_at"> {
  return {
    dispute_id: disputeId,
    shop_id: shopId,
    order_gid: orderGid,
    state: s.kind,
    unknown_reason: s.reason,
    pending_amount: s.pendingAmount,
    settled_amount: s.settledAmount,
    failed_amount: s.failedAmount,
    currency: s.currency,
    first_refund_at: s.firstRefundAt,
    settled_at: s.settledAt,
    stalled_pending: s.stalledPending,
    return_status: s.returnStatus,
    payment_gateways: s.paymentGateways,
    checked_at: now,
  };
}

/**
 * Store a read. `last_changed_at` moves only when the state kind changed since the previous row.
 * Returns `{ changed, previous }` so callers (the cron) can log transitions.
 */
export async function upsertRefundState(
  sb: SupabaseClient,
  disputeId: string,
  shopId: string,
  orderGid: string,
  s: RefundState,
  now: string = new Date().toISOString(),
): Promise<{ changed: boolean; previous: RefundState["kind"] | null }> {
  const { data: prev, error: readErr } = await sb
    .from("dispute_refund_state")
    .select("state")
    .eq("dispute_id", disputeId)
    .maybeSingle();
  if (readErr) throw new Error(`dispute_refund_state read failed: ${readErr.message}`);

  const previous = (prev?.state as RefundState["kind"] | undefined) ?? null;
  const changed = previous !== s.kind;
  const row = {
    ...refundStateRow(disputeId, shopId, orderGid, s, now),
    ...(changed ? { last_changed_at: now } : {}),
  };
  const { error } = await sb.from("dispute_refund_state").upsert(row, { onConflict: "dispute_id" });
  if (error) throw new Error(`dispute_refund_state upsert failed: ${error.message}`);
  return { changed, previous };
}

export async function loadRefundState(sb: SupabaseClient, disputeId: string): Promise<StoredRefundState | null> {
  const { data, error } = await sb.from("dispute_refund_state").select("*").eq("dispute_id", disputeId).maybeSingle();
  if (error) throw new Error(`dispute_refund_state read failed: ${error.message}`);
  return (data as StoredRefundState | null) ?? null;
}

/** Stored states for many disputes at once, keyed by dispute id (chunked: PostgREST caps `in` lists and rows). */
export async function loadRefundStateRows(
  sb: SupabaseClient,
  disputeIds: string[],
): Promise<Map<string, StoredRefundState>> {
  const out = new Map<string, StoredRefundState>();
  for (let i = 0; i < disputeIds.length; i += 100) {
    const { data, error } = await sb
      .from("dispute_refund_state")
      .select("*")
      .in("dispute_id", disputeIds.slice(i, i + 100));
    if (error) throw new Error(`dispute_refund_state read failed: ${error.message}`);
    for (const row of (data ?? []) as StoredRefundState[]) out.set(row.dispute_id, row);
  }
  return out;
}

/** What the dispute page needs of a stored state. Serialisable; merchant-only. */
export interface PageRefundState {
  kind: RefundState["kind"];
  pendingAmount: number;
  settledAmount: number;
  failedAmount: number;
  currency: string | null;
  firstRefundAt: string | null;
  settledAt: string | null;
  stalledPending: boolean;
  checkedAt: string;
}

export function toPageRefundState(row: StoredRefundState | null): PageRefundState | null {
  if (!row) return null;
  return {
    kind: row.state,
    pendingAmount: Number(row.pending_amount),
    settledAmount: Number(row.settled_amount),
    failedAmount: Number(row.failed_amount),
    currency: row.currency,
    firstRefundAt: row.first_refund_at,
    settledAt: row.settled_at,
    stalledPending: row.stalled_pending,
    checkedAt: row.checked_at,
  };
}

/** A snapshot older than this is not evidence of the present: the cron runs every 3 h. */
export const REFUND_STATE_FRESH_MS = 12 * 60 * 60 * 1000;

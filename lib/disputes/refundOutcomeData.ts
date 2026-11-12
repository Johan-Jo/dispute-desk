/**
 * Data access for the per-store refund results (`lib/disputes/refundOutcomeStats.ts`) and for the one-time
 * "final read" of closed / escalated inquiries that feeds them.
 *
 * A refund's settlement time is readable at any later moment (`Refund.updatedAt`), so a closed or escalated
 * inquiry needs exactly one live read, ever; its row then carries `final_read_at`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefundOutcomeRow } from "@/lib/disputes/refundOutcomeStats";
import { REFUND_ADVICE_REASON } from "@/lib/disputes/refundAdviceDecision";

const CHUNK = 100;
const WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

interface InquiryOriginDispute {
  id: string;
  shop_id: string;
  order_gid: string | null;
  normalized_status: string | null;
  initiated_at: string | null;
  closed_at: string | null;
  escalated_from_inquiry_at: string | null;
}

const COLUMNS = "id, shop_id, order_gid, normalized_status, initiated_at, closed_at, escalated_from_inquiry_at";

/** Inquiry-origin disputes that have ENDED (closed as an inquiry, or escalated), initiated in the last 12 months. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder passed through
async function endedInquiries(sb: SupabaseClient, filter: (q: any) => any, now: number): Promise<InquiryOriginDispute[]> {
  const since = new Date(now - WINDOW_MS).toISOString();
  const out: InquiryOriginDispute[] = [];
  for (let from = 0; ; from += 1000) {
    const q = filter(
      sb
        .from("disputes")
        .select(COLUMNS)
        .gte("initiated_at", since)
        // closed as an inquiry (won / lost), or escalated from one
        .or("and(phase.eq.inquiry,normalized_status.in.(won,lost)),escalated_from_inquiry_at.not.is.null")
        .order("initiated_at", { ascending: false })
        .range(from, from + 999),
    );
    const { data, error } = await q;
    if (error) throw new Error(`ended inquiries read failed: ${error.message}`);
    out.push(...((data ?? []) as InquiryOriginDispute[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * One shop's rows for `computeRefundOutcomeStats`, CREDIT_NOT_PROCESSED only: the email quotes these figures to a
 * merchant with a credit-not-processed inquiry, and for other reasons a refund concedes the claim (measured
 * 2026-11-12: 6a8848-dd closed 0 of 146 refunded product-not-received / not-as-described inquiries in its favour).
 * Disputes never read from Shopify carry `settlements: null`.
 */
export async function loadRefundOutcomeRows(sb: SupabaseClient, shopId: string, now = Date.now()): Promise<RefundOutcomeRow[]> {
  const disputes = await endedInquiries(sb, (q) => q.eq("shop_id", shopId).eq("reason", REFUND_ADVICE_REASON), now);
  const states = new Map<string, Array<{ settledAt: string; amount: number }>>();
  for (let i = 0; i < disputes.length; i += CHUNK) {
    const { data, error } = await sb
      .from("dispute_refund_state")
      .select("dispute_id, settlements, final_read_at")
      .in("dispute_id", disputes.slice(i, i + CHUNK).map((d) => d.id))
      .not("final_read_at", "is", null);
    if (error) throw new Error(`dispute_refund_state read failed: ${error.message}`);
    for (const r of data ?? []) states.set(r.dispute_id as string, (r.settlements ?? []) as Array<{ settledAt: string; amount: number }>);
  }
  return disputes.map((d) => ({
    outcome: d.normalized_status === "won" || d.normalized_status === "lost" ? d.normalized_status : null,
    initiatedAt: d.initiated_at,
    closedAt: d.closed_at,
    escalatedAt: d.escalated_from_inquiry_at,
    settlements: states.get(d.id) ?? null,
  }));
}

export interface FinalReadCandidate {
  disputeId: string;
  shopId: string;
  orderGid: string;
}

/** Ended inquiry-origin disputes with no final read yet, newest first, at most `limit`. */
export async function loadFinalReadCandidates(sb: SupabaseClient, limit: number, now = Date.now()): Promise<FinalReadCandidate[]> {
  const disputes = (await endedInquiries(sb, (q) => q, now)).filter((d) => d.order_gid);
  const done = new Set<string>();
  for (let i = 0; i < disputes.length; i += CHUNK) {
    const { data, error } = await sb
      .from("dispute_refund_state")
      .select("dispute_id")
      .in("dispute_id", disputes.slice(i, i + CHUNK).map((d) => d.id))
      .not("final_read_at", "is", null);
    if (error) throw new Error(`dispute_refund_state read failed: ${error.message}`);
    for (const r of data ?? []) done.add(r.dispute_id as string);
  }
  return disputes
    .filter((d) => !done.has(d.id))
    .slice(0, limit)
    .map((d) => ({ disputeId: d.id, shopId: d.shop_id, orderGid: d.order_gid as string }));
}

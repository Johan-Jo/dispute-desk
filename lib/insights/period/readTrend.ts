/**
 * The 12-month card-ratio trend, read from the month records only (never
 * computed on read). A month without a record is shown as not available,
 * not as zero; months before the shop's history are not in the window.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface TrendPoint {
  periodMonth: string;
  periodState: "final" | "provisional" | "not_available";
  cardDisputeRatio: number | null;
  cardChargebackCount: number | null;
  cardSettledCount: number | null;
}

export async function readTrend(sb: SupabaseClient, shopId: string, window: string[]): Promise<TrendPoint[]> {
  if (window.length === 0) return [];
  const { data, error } = await sb
    .from("ratio_snapshots")
    .select("period_month, stable_at, metrics_version, card_dispute_ratio, card_chargeback_count, settled_count")
    .eq("shop_id", shopId)
    .in("period_month", window);
  if (error) throw new Error(`readTrend: ${error.message}`);
  const byMonth = new Map(((data ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.period_month).slice(0, 10), r]));
  return window.map((m) => {
    const r = byMonth.get(m);
    if (!r || Number(r.metrics_version ?? 1) < 2) {
      return { periodMonth: m, periodState: "not_available", cardDisputeRatio: null, cardChargebackCount: null, cardSettledCount: null };
    }
    return {
      periodMonth: m,
      periodState: r.stable_at ? "final" : "provisional",
      cardDisputeRatio: r.card_dispute_ratio === null ? null : Number(r.card_dispute_ratio),
      cardChargebackCount: Number(r.card_chargeback_count ?? 0),
      cardSettledCount: Number(r.settled_count ?? 0),
    };
  });
}

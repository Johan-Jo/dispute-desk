/**
 * The 12-month trend, read from the month records only (never computed on
 * read). A month without a record is shown as not available, not as zero;
 * months before the shop's history are not in the window.
 *
 * Two views of the same months: the card ratio the networks judge, and the
 * NUMBER of chargebacks across every payment method. The second is summed
 * from the record's stored `byPaymentMethod` rows, so it always agrees with
 * the payment-method table; it is `null` on a record without that split.
 *
 * It is a count, not a rate, on purpose. A rate over all orders divides by a
 * larger number than the card ratio does, so for a shop whose chargebacks are
 * all on cards "all methods" read LOWER than "cards only" (blume-box,
 * September 2026: 0.09% against 0.15%, the same 4 chargebacks). A count can
 * never be below the card chargebacks it contains.
 */

import type { SupabaseClient } from "@supabase/supabase-js";


export interface TrendPoint {
  periodMonth: string;
  periodState: "final" | "provisional" | "not_available";
  cardDisputeRatio: number | null;
  cardChargebackCount: number | null;
  cardSettledCount: number | null;
  /** Chargebacks opened in the month on any payment method. Inquiries are
   *  not counted. */
  allChargebackCount?: number | null;
  /** The part of `allChargebackCount` on card-network methods. */
  allCardChargebackCount?: number | null;
  /** Orders placed in the month on any method. */
  allOrderCount?: number | null;
}

const NO_ALL = { allChargebackCount: null, allCardChargebackCount: null, allOrderCount: null };

function allMethods(operational: unknown): typeof NO_ALL | { allChargebackCount: number; allCardChargebackCount: number; allOrderCount: number } {
  const rows = (operational as { byPaymentMethod?: unknown } | null)?.byPaymentMethod;
  if (!Array.isArray(rows)) return NO_ALL;
  let chargebacks = 0;
  let cardChargebacks = 0;
  let orders = 0;
  for (const r of rows as Array<{ chargebacks?: number; orders?: number; isCardNetwork?: boolean }>) {
    chargebacks += Number(r.chargebacks ?? 0);
    if (r.isCardNetwork) cardChargebacks += Number(r.chargebacks ?? 0);
    orders += Number(r.orders ?? 0);
  }
  return {
    allChargebackCount: chargebacks,
    allCardChargebackCount: cardChargebacks,
    allOrderCount: orders,
  };
}

export async function readTrend(sb: SupabaseClient, shopId: string, window: string[]): Promise<TrendPoint[]> {
  if (window.length === 0) return [];
  const { data, error } = await sb
    .from("ratio_snapshots")
    .select("period_month, stable_at, metrics_version, card_dispute_ratio, card_chargeback_count, settled_count, coverage, operational_metrics")
    .eq("shop_id", shopId)
    .in("period_month", window);
  if (error) throw new Error(`readTrend: ${error.message}`);
  const byMonth = new Map(((data ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.period_month).slice(0, 10), r]));
  return window.map((m) => {
    const r = byMonth.get(m);
    if (!r || Number(r.metrics_version ?? 1) < 2) {
      return { periodMonth: m, periodState: "not_available", cardDisputeRatio: null, cardChargebackCount: null, cardSettledCount: null, ...NO_ALL };
    }
    return {
      periodMonth: m,
      periodState: r.stable_at ? "final" : "provisional",
      cardDisputeRatio: r.card_dispute_ratio === null ? null : Number(r.card_dispute_ratio),
      cardChargebackCount: Number(r.card_chargeback_count ?? 0),
      cardSettledCount: Number(r.settled_count ?? 0),
      // A month the import only partly covers would draw a count from a
      // fraction of the month beside full months, and drag the average down.
      // The month view calls the same row "not fully imported".
      ...(r.coverage === "partial" ? NO_ALL : allMethods(r.operational_metrics)),
    };
  });
}

/**
 * Dispute reasons, one month against the month before it.
 *
 * Both sides come from stored month records (`operational.byReason`); nothing
 * is counted here. `previous === null` means the earlier month has no reasons
 * on record (no row, a partial month, or a record written before metrics v4):
 * its counts and every change are then `null` — "not measured", never zero.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReasonRow } from "./computeOperationalMetrics";
import { addMonths } from "./months";

export interface PreviousReasons {
  periodMonth: string;
  byReason: ReasonRow[];
}

export interface ReasonComparisonRow {
  reason: string;
  current: number;
  previous: number | null;
  /** current ÷ the month's total; null when the month had none of this reason. */
  share: number | null;
  /** current − previous; null when the earlier month was not measured. */
  change: number | null;
  /** The earlier month had none of this reason and this month has some. */
  isNew: boolean;
}

export interface ReasonComparison {
  rows: ReasonComparisonRow[];
  currentTotal: number;
  previousTotal: number | null;
  /** The larger single count on either side, for the bar scale (≥ 1). */
  max: number;
}

export function compareReasons(current: ReasonRow[], previous: ReasonRow[] | null): ReasonComparison {
  const cur = new Map(current.map((r) => [r.reason, r.disputes]));
  const prev = previous === null ? null : new Map(previous.map((r) => [r.reason, r.disputes]));
  const currentTotal = current.reduce((n, r) => n + r.disputes, 0);
  const reasons = [...new Set([...cur.keys(), ...(prev ? prev.keys() : [])])];
  const rows = reasons
    .map((reason): ReasonComparisonRow => {
      const c = cur.get(reason) ?? 0;
      const p = prev === null ? null : (prev.get(reason) ?? 0);
      return {
        reason,
        current: c,
        previous: p,
        share: c > 0 && currentTotal > 0 ? c / currentTotal : null,
        change: p === null ? null : c - p,
        isNew: p === 0 && c > 0,
      };
    })
    .filter((r) => r.current + (r.previous ?? 0) > 0)
    .sort((a, b) => b.current - a.current || (b.previous ?? 0) - (a.previous ?? 0) || a.reason.localeCompare(b.reason));
  return {
    rows,
    currentTotal,
    previousTotal: previous === null ? null : previous.reduce((n, r) => n + r.disputes, 0),
    max: Math.max(1, ...rows.flatMap((r) => [r.current, r.previous ?? 0])),
  };
}

/** The reasons stored on the month before `month`, or null when that month
 *  has none on record. Read from the record, never computed here. */
export async function readPreviousReasons(
  sb: SupabaseClient,
  shopId: string,
  month: string,
): Promise<PreviousReasons | null> {
  const periodMonth = addMonths(month, -1);
  const { data, error } = await sb
    .from("ratio_snapshots")
    .select("coverage, operational_metrics")
    .eq("shop_id", shopId)
    .eq("period_month", periodMonth)
    .maybeSingle();
  if (error) throw new Error(`readPreviousReasons: ${error.message}`);
  const row = data as { coverage?: string | null; operational_metrics?: { byReason?: ReasonRow[] } | null } | null;
  const byReason = row?.operational_metrics?.byReason;
  if (!row || row.coverage === "partial" || !Array.isArray(byReason)) return null;
  return { periodMonth, byReason };
}

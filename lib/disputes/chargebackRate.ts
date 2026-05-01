/**
 * Chargeback rate computation against the daily snapshot table.
 *
 * Reads `shop_daily_metrics` rather than computing live from raw
 * disputes + Shopify (PRD §6, §12: "all calculations from
 * shop_daily_metrics; no live Shopify queries in UI"). When the
 * snapshot is missing for a window the helper returns `available:
 * false` so the UI can render a loading/empty state instead of a
 * misleading zero.
 *
 * Numerator: `chargeback_count` (PRD §3 — inquiries excluded).
 * Denominator: `order_count` (gross — PRD §3 rule).
 *
 * Period-over-period delta is in **percentage points** (PRD §7,
 * matches the `winRate` convention in metrics.ts).
 */

import { getServiceClient } from "@/lib/supabase/server";

export interface ChargebackRateOptions {
  shopId: string;
  /** Inclusive lower bound (YYYY-MM-DD UTC). When omitted, all
   *  snapshot rows for the shop are summed (admin all-time view). */
  fromDate?: string;
  /** Inclusive upper bound (YYYY-MM-DD UTC). Defaults to yesterday
   *  UTC since the snapshot job only writes completed days. */
  toDate?: string;
}

export interface ChargebackRateResult {
  /** % rate (`100 * chargebacks / orders`), one decimal place. Null
   *  when no snapshot data covers the window or when there were zero
   *  orders. The UI shows "—" in both cases. */
  rate: number | null;
  /** Change vs. the prior equal-length window, in percentage points
   *  (not percent). Null when the prior window has no data. */
  rateChange: number | null;
  /** Sum of chargeback_count over the window. */
  numerator: number;
  /** Sum of order_count over the window. */
  denominator: number;
  /** True when at least one snapshot row exists in the window. The
   *  dashboard uses this to distinguish "not yet snapshotted" from
   *  "genuinely zero." */
  available: boolean;
  /** True when the denominator is below the volume floor and the rate
   *  is statistically noisy (PRD §11). */
  lowVolume: boolean;
  /** Distinct snapshot days present in the window. */
  daysCovered: number;
  /** Days the window covers (denominator's "expected coverage"). */
  daysExpected: number;
  /** Most recent `last_synced_at` across rows in the window — used by
   *  the admin Sync freshness signal (PRD §9). */
  lastSyncedAt: string | null;
}

const LOW_VOLUME_THRESHOLD = 50;

/** Yesterday's UTC date in YYYY-MM-DD form. Snapshot rows only land
 *  for completed days, so this is the natural window upper bound. */
export function defaultWindowEndDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Compose `fromDate` for a rolling N-day window ending at `toDate`. */
export function windowStartDate(toDate: string, days: number): string {
  const d = new Date(`${toDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Diff in days between two YYYY-MM-DD UTC dates, inclusive. */
function daysBetweenInclusive(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`).getTime();
  const b = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}

interface SnapshotRow {
  date: string;
  order_count: number | null;
  chargeback_count: number | null;
  last_synced_at: string | null;
}

async function readWindow(
  shopId: string,
  fromDate: string | null,
  toDate: string,
): Promise<SnapshotRow[]> {
  const sb = getServiceClient();
  let q = sb
    .from("shop_daily_metrics")
    .select("date, order_count, chargeback_count, last_synced_at")
    .eq("shop_id", shopId)
    .lte("date", toDate);
  if (fromDate) q = q.gte("date", fromDate);
  const { data } = await q;
  return (data ?? []) as SnapshotRow[];
}

function summarize(
  rows: SnapshotRow[],
  daysExpected: number,
): Omit<ChargebackRateResult, "rateChange"> {
  const numerator = rows.reduce((s, r) => s + (r.chargeback_count ?? 0), 0);
  const denominator = rows.reduce((s, r) => s + (r.order_count ?? 0), 0);
  const lastSyncedAt =
    rows
      .map((r) => r.last_synced_at)
      .filter((v): v is string => typeof v === "string")
      .sort()
      .at(-1) ?? null;
  const available = rows.length > 0;
  const rate = available && denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10 // one decimal place, percent
    : null;
  return {
    rate,
    numerator,
    denominator,
    available,
    lowVolume: denominator < LOW_VOLUME_THRESHOLD,
    daysCovered: rows.length,
    daysExpected,
    lastSyncedAt,
  };
}

export async function computeChargebackRate(
  opts: ChargebackRateOptions,
): Promise<ChargebackRateResult> {
  const toDate = opts.toDate ?? defaultWindowEndDate();
  const fromDate = opts.fromDate ?? null;

  const rows = await readWindow(opts.shopId, fromDate, toDate);
  const daysExpected = fromDate ? daysBetweenInclusive(fromDate, toDate) : rows.length;
  const current = summarize(rows, daysExpected);

  // Period-over-period: same length window immediately before
  // `fromDate`. Skipped when fromDate is unset (all-time view has no
  // natural prior window).
  let rateChange: number | null = null;
  if (fromDate) {
    const prevTo = (() => {
      const d = new Date(`${fromDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const prevFrom = windowStartDate(prevTo, daysExpected);
    const prevRows = await readWindow(opts.shopId, prevFrom, prevTo);
    const prev = summarize(prevRows, daysExpected);
    if (current.rate !== null && prev.rate !== null) {
      // Round to one decimal point to match the rate display.
      rateChange = Math.round((current.rate - prev.rate) * 10) / 10;
    }
  }

  return { ...current, rateChange };
}

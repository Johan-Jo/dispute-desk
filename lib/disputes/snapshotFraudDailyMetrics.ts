/**
 * Snapshot one (shop, date) row into `shop_fraud_daily_metrics`.
 *
 * Phase 1 fraud-intelligence rollup. Unlike `shop_daily_metrics`,
 * this aggregator does NOT hit Shopify — all source data lives in
 * the local `shopify_orders` + `disputes` tables (populated by the
 * order-backfill orchestrator and the dispute-sync job respectively).
 * One pass over the local rows for the UTC date is enough.
 *
 * Inputs:
 *   - shopId — internal `shops.id`
 *   - dateIso — `YYYY-MM-DD` (UTC). UTC-anchored to match the rest
 *     of the metrics stack.
 *
 * Side effect: upserts a single row into `shop_fraud_daily_metrics`
 * keyed by (shop_id, date). Idempotent — re-runs refresh `last_synced_at`.
 *
 * Metric semantics (must match dashboard tooltip copy):
 *   - orders_total: all orders processed in the UTC day.
 *   - orders_low / medium / high / none / pending: bucketed by
 *     `risk_level_initial`. NONE and PENDING are TRACKED but
 *     intentionally excluded from the acceptance-rate denominator
 *     — the dashboard tooltip must disclose this.
 *   - orders_fulfilled_high_risk: subset of orders_high where
 *     `fulfillment_status` is FULFILLED or PARTIAL. Drives the
 *     high-risk fulfillment-rate KPI.
 *   - fraud_disputes: subset of disputes initiated on this date with
 *     `reason = 'FRAUDULENT'` (Shopify's canonical fraud reason code).
 *   - total_disputes: count of all disputes initiated on this date.
 *   - chargebacks: subset of total_disputes where phase='chargeback'.
 *   - fully_protected_value: sum of order_total where
 *     fraud_protection_level is a COVERED status (PROTECTED or ACTIVE
 *     — the Coverage Gate's canonical set, imported not redeclared).
 *   - eligible_protected_value: sum of order_total where
 *     fraud_protection_level IN ('PROTECTED','ACTIVE','PENDING') —
 *     the orders Shopify Protect could underwrite if a dispute lands.
 *
 * Tracking gap: the orders columns only count orders whose
 * `processed_at` (or `created_at_shopify` fallback) falls in the
 * UTC date — same convention as `shopify_orders.processed_at` carries.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { COVERED_STATUSES } from "@/lib/packs/sources/coverageSource";

export interface FraudSnapshotResult {
  shopId: string;
  date: string;
  ordersTotal: number;
  ordersHigh: number;
  fraudDisputes: number;
  totalDisputes: number;
  chargebacks: number;
}

/** PostgREST silently caps un-ranged selects at 1000 rows. Every
 *  multi-row read in this module MUST paginate with `.range()` — the
 *  original un-paginated date scan truncated a 12.8k-order shop to its
 *  first 1000 rows, leaving the MoM prior window empty ("no prior
 *  period" on every KPI tile, K-Collective 2026-07-17). Ordered by
 *  `id` so pages are stable across requests. */
const DB_PAGE_SIZE = 1000;

const FULFILLED_STATUSES = new Set<string>(["FULFILLED", "PARTIAL", "PARTIALLY_FULFILLED"]);
/** Numerator for the Protect-coverage KPI. Imported from the Coverage
 *  Gate rather than redeclared: this used to be a local
 *  `new Set(["PROTECTED"])`, which disagreed with the gate's
 *  {PROTECTED, ACTIVE} and reported 0% coverage for orders the pipeline
 *  refuses to auto-save BECAUSE they are covered. */
const PROTECTED_STATUSES = COVERED_STATUSES;
const ELIGIBLE_PROTECTED_STATUSES = new Set<string>([
  "PROTECTED",
  "ACTIVE",
  "PENDING",
]);

export async function snapshotFraudDailyMetrics(
  shopId: string,
  dateIso: string,
): Promise<FraudSnapshotResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error(
      `snapshotFraudDailyMetrics: invalid date "${dateIso}", expected YYYY-MM-DD`,
    );
  }
  const sb = getServiceClient();
  const startIso = `${dateIso}T00:00:00Z`;
  const endIso = `${nextDateIso(dateIso)}T00:00:00Z`;

  // ── Orders rows for the day ─────────────────────────────────────
  // processed_at is the primary anchor (Shopify's "this is when the
  // order processed" timestamp). Falls back to created_at_shopify
  // when processed_at is null (rare — abandoned/pending orders).
  // Paginated: a >1000-order day would otherwise be silently truncated.
  const rows: OrderRowForAggregation[] = [];
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data: orderRows, error: ordersErr } = await sb
      .from("shopify_orders")
      .select(
        "risk_level_initial, fulfillment_status, fraud_protection_level, order_total, processed_at, created_at_shopify",
      )
      .eq("shop_id", shopId)
      .or(
        `and(processed_at.gte.${startIso},processed_at.lt.${endIso}),and(processed_at.is.null,created_at_shopify.gte.${startIso},created_at_shopify.lt.${endIso})`,
      )
      .order("id", { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1);
    if (ordersErr) {
      throw new Error(`shopify_orders lookup failed: ${ordersErr.message}`);
    }
    rows.push(...((orderRows ?? []) as OrderRowForAggregation[]));
    if (!orderRows || orderRows.length < DB_PAGE_SIZE) break;
  }
  const counts = aggregateOrderCounts(rows);

  // ── Disputes initiated on the day ───────────────────────────────
  const { data: disputeRows, error: disputeErr } = await sb
    .from("disputes")
    .select("id, phase, reason")
    .eq("shop_id", shopId)
    .gte("initiated_at", startIso)
    .lt("initiated_at", endIso);
  if (disputeErr) {
    throw new Error(`disputes lookup failed: ${disputeErr.message}`);
  }
  const disputes = disputeRows ?? [];
  let fraudDisputes = 0;
  let chargebacks = 0;
  for (const d of disputes) {
    if (typeof d.reason === "string" && d.reason.toUpperCase() === "FRAUDULENT") {
      fraudDisputes += 1;
    }
    if (d.phase === "chargeback") chargebacks += 1;
  }

  // ── Upsert ──────────────────────────────────────────────────────
  const row = {
    shop_id: shopId,
    date: dateIso,
    orders_total: counts.ordersTotal,
    orders_low: counts.ordersLow,
    orders_medium: counts.ordersMedium,
    orders_high: counts.ordersHigh,
    orders_none: counts.ordersNone,
    orders_pending: counts.ordersPending,
    orders_fulfilled_high_risk: counts.ordersFulfilledHighRisk,
    fraud_disputes: fraudDisputes,
    total_disputes: disputes.length,
    chargebacks,
    fully_protected_value: counts.fullyProtectedValue,
    eligible_protected_value: counts.eligibleProtectedValue,
    last_synced_at: new Date().toISOString(),
  };
  const { error: upErr } = await sb
    .from("shop_fraud_daily_metrics")
    .upsert(row, { onConflict: "shop_id,date" });
  if (upErr) {
    throw new Error(`shop_fraud_daily_metrics upsert failed: ${upErr.message}`);
  }

  return {
    shopId,
    date: dateIso,
    ordersTotal: counts.ordersTotal,
    ordersHigh: counts.ordersHigh,
    fraudDisputes,
    totalDisputes: disputes.length,
    chargebacks,
  };
}

interface OrderRowForAggregation {
  risk_level_initial: string | null;
  fulfillment_status: string | null;
  fraud_protection_level: string | null;
  order_total: number | string | null;
}

export interface FraudOrderCounts {
  ordersTotal: number;
  ordersLow: number;
  ordersMedium: number;
  ordersHigh: number;
  ordersNone: number;
  ordersPending: number;
  ordersFulfilledHighRisk: number;
  fullyProtectedValue: number;
  eligibleProtectedValue: number;
}

/** Pure: aggregate the count + value buckets from a list of order rows. */
export function aggregateOrderCounts(
  rows: OrderRowForAggregation[],
): FraudOrderCounts {
  const out: FraudOrderCounts = {
    ordersTotal: rows.length,
    ordersLow: 0,
    ordersMedium: 0,
    ordersHigh: 0,
    ordersNone: 0,
    ordersPending: 0,
    ordersFulfilledHighRisk: 0,
    fullyProtectedValue: 0,
    eligibleProtectedValue: 0,
  };
  for (const r of rows) {
    const risk = (r.risk_level_initial ?? "").toUpperCase();
    switch (risk) {
      case "LOW":
        out.ordersLow += 1;
        break;
      case "MEDIUM":
        out.ordersMedium += 1;
        break;
      case "HIGH":
        out.ordersHigh += 1;
        // High-risk orders that still reached fulfilled state drive
        // the High-Risk Fulfillment Rate KPI (critical metric per PRD §13).
        if (
          r.fulfillment_status &&
          FULFILLED_STATUSES.has(r.fulfillment_status.toUpperCase())
        ) {
          out.ordersFulfilledHighRisk += 1;
        }
        break;
      case "PENDING":
        out.ordersPending += 1;
        break;
      case "NONE":
      default:
        // null risk_level_initial and any unexpected value are bucketed
        // as "none" — the assessment was not present at ingest time.
        out.ordersNone += 1;
        break;
    }

    const total = Number(r.order_total ?? 0);
    if (Number.isFinite(total) && total > 0 && r.fraud_protection_level) {
      const status = r.fraud_protection_level.toUpperCase();
      if (PROTECTED_STATUSES.has(status)) out.fullyProtectedValue += total;
      if (ELIGIBLE_PROTECTED_STATUSES.has(status))
        out.eligibleProtectedValue += total;
    }
  }
  return out;
}

function nextDateIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Backfill all daily rollups for a shop. Iterates the distinct UTC
 * dates with rows in `shopify_orders` for this shop and snapshots
 * each one. Triggered automatically when the order-backfill
 * orchestrator flips `historical_import_status` to 'complete'.
 *
 * Cheap-ish: each date is one Postgres aggregation. A 60-day window
 * is 60 round trips. The orchestrator runs this synchronously inside
 * the backfill_fraud_daily_metrics handler so it's bounded by the
 * 300s `maxDuration` like its sibling.
 */
/** Rollup rows synced within this window are skipped by the backfill.
 *  This is what makes the job CONVERGE across worker retries: a large
 *  shop (~1100 order-dates) cannot finish inside the worker's 300s
 *  maxDuration, and without the skip every retry re-ran the same date
 *  prefix from scratch and timed out at the same point (K-Collective,
 *  2026-07-17 — 3 attempts, zero net progress on the recent window).
 *  48h is generous: anything the previous attempt (or the daily cron)
 *  wrote is still accurate, while genuinely stale rows refresh. */
const BACKFILL_SKIP_FRESH_MS = 48 * 3600 * 1000;

export async function backfillFraudDailyMetrics(
  shopId: string,
): Promise<{ shopId: string; daysWritten: number; daysSkipped: number }> {
  const sb = getServiceClient();

  // Paginated scan of the per-shop timestamp columns. The original
  // un-paginated version hit PostgREST's silent 1000-row cap, so a
  // multi-year shop's backfill only rolled up the dates covered by its
  // first 1000 rows. A future RPC could DISTINCT this server-side;
  // not needed for v1.
  const dateSet = new Set<string>();
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data: rows, error: scanErr } = await sb
      .from("shopify_orders")
      .select("processed_at, created_at_shopify")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1);
    if (scanErr) {
      throw new Error(`shopify_orders date scan failed: ${scanErr.message}`);
    }
    for (const r of rows ?? []) {
      const ts = (r.processed_at ?? r.created_at_shopify) as string | null;
      if (!ts) continue;
      dateSet.add(ts.slice(0, 10));
    }
    if (!rows || rows.length < DB_PAGE_SIZE) break;
  }

  // Resume support: skip dates whose rollup row is already fresh —
  // see BACKFILL_SKIP_FRESH_MS. Paginated like every other multi-row
  // read in this module.
  const freshDates = new Set<string>();
  const nowMs = Date.now();
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data: existing, error: existingErr } = await sb
      .from("shop_fraud_daily_metrics")
      .select("date, last_synced_at")
      .eq("shop_id", shopId)
      .order("date", { ascending: true })
      .range(from, from + DB_PAGE_SIZE - 1);
    if (existingErr) {
      throw new Error(
        `shop_fraud_daily_metrics freshness scan failed: ${existingErr.message}`,
      );
    }
    for (const r of existing ?? []) {
      const syncedMs = r.last_synced_at ? Date.parse(r.last_synced_at as string) : NaN;
      if (Number.isFinite(syncedMs) && nowMs - syncedMs < BACKFILL_SKIP_FRESH_MS) {
        freshDates.add((r.date as string).slice(0, 10));
      }
    }
    if (!existing || existing.length < DB_PAGE_SIZE) break;
  }

  // Newest-first: if an attempt still hits the 300s budget, the dates
  // the dashboard actually reads (trailing 90d + MoM prior window)
  // are written first, and the next retry resumes from where this one
  // stopped instead of re-doing its work.
  const dates = Array.from(dateSet)
    .filter((d) => !freshDates.has(d))
    .sort()
    .reverse();

  for (const date of dates) {
    await snapshotFraudDailyMetrics(shopId, date);
  }
  return {
    shopId,
    daysWritten: dates.length,
    daysSkipped: dateSet.size - dates.length,
  };
}

/** Yesterday in UTC (`YYYY-MM-DD`). The most recent fully complete day. */
export function fraudYesterdayUtcDateIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

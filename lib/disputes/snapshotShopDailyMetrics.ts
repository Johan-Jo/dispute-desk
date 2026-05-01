/**
 * Snapshot one (shop, date) row into `shop_daily_metrics`.
 *
 * Inputs:
 *   - shopId — internal `shops.id`
 *   - dateIso — `YYYY-MM-DD` (UTC). The snapshot is anchored to UTC
 *     midnight boundaries; merchant timezones are intentionally not
 *     considered. The chargeback-rate metric is reported in UTC days.
 *
 * Sources:
 *   - Order data: live Shopify Admin GraphQL `orders` connection
 *     (paginated). Replaces the prior `ordersCount` field, which
 *     returned wrong values for narrow `created_at:` range filters
 *     (verified against surasvenne, 2026-05-01: window-level count
 *     was 7 but per-day-summed count was 14). The orders connection
 *     correctly honors the range filter, so we paginate and group
 *     by UTC date in code.
 *   - Test orders (`test === true`) are **excluded** from the
 *     denominator and from the dispute-test-filter set.
 *   - Dispute counts: local `disputes` table filtered by
 *     `initiated_at` falling inside the UTC day, split by `phase`.
 *     Disputes whose `order_gid` matches a test order are excluded
 *     so the rate reflects real merchant activity only.
 *
 * Side effect: upserts a single row into `shop_daily_metrics` keyed by
 * (shop_id, date). Re-runs are idempotent and refresh `last_synced_at`.
 *
 * Failure modes:
 *   - No offline session → throws `NoBackgroundSessionError` (the cron
 *     skips this shop on the next round).
 *   - Shopify auth invalid → throws `ShopifyAuthInvalidError`.
 *   - Shopify GraphQL error → propagates; the job runner retries
 *     according to `jobs.max_attempts`.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import {
  fetchOrdersInWindow,
  bucketOrdersByUtcDay,
  testOrderGidSet,
} from "@/lib/shopify/queries/ordersForSnapshot";

export interface SnapshotResult {
  shopId: string;
  date: string;
  orderCount: number;
  disputeCount: number;
  chargebackCount: number;
  inquiryCount: number;
}

export async function snapshotShopDailyMetrics(
  shopId: string,
  dateIso: string,
  opts: { correlationId?: string } = {},
): Promise<SnapshotResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error(`snapshotShopDailyMetrics: invalid date "${dateIso}", expected YYYY-MM-DD`);
  }

  const session = await getShopBackgroundSession(shopId);
  const nextDate = nextDateIso(dateIso);

  // ── Orders for the day (paginated; typically one page). ────────
  const orders = await fetchOrdersInWindow(
    { shopDomain: session.shopDomain, accessToken: session.accessToken },
    dateIso,
    nextDate,
    { correlationId: opts.correlationId ?? `snapshot-${shopId}-${dateIso}` },
  );

  const buckets = bucketOrdersByUtcDay(orders);
  const orderCount = buckets.get(dateIso) ?? 0;
  const testGids = testOrderGidSet(orders);

  // ── Disputes initiated in the UTC day ──────────────────────────
  // Pulled from local table — kept fresh by the routine sync_disputes
  // job (every 5 min). Disputes tied to a test order are excluded
  // from both numerator and `dispute_count` so the row reflects real
  // merchant activity only (PRD: "Chargeback rate must reflect real
  // merchant activity only").
  const sb = getServiceClient();
  const startIso = `${dateIso}T00:00:00Z`;
  const endIso = `${nextDate}T00:00:00Z`;

  const { data: disputeRows, error: disputeErr } = await sb
    .from("disputes")
    .select("id, phase, order_gid")
    .eq("shop_id", shopId)
    .gte("initiated_at", startIso)
    .lt("initiated_at", endIso);

  if (disputeErr) {
    throw new Error(`disputes lookup failed: ${disputeErr.message}`);
  }

  let chargebackCount = 0;
  let inquiryCount = 0;
  let disputeCount = 0;
  for (const row of disputeRows ?? []) {
    if (row.order_gid && testGids.has(row.order_gid)) continue;
    disputeCount += 1;
    if (row.phase === "chargeback") chargebackCount += 1;
    else if (row.phase === "inquiry") inquiryCount += 1;
    // phase NULL is excluded from both phase buckets but counted in
    // `dispute_count` (PRD §11 — handle legacy phase nulls).
  }

  // ── Upsert ──────────────────────────────────────────────────────
  const { error: upsertErr } = await sb
    .from("shop_daily_metrics")
    .upsert(
      {
        shop_id: shopId,
        date: dateIso,
        order_count: orderCount,
        dispute_count: disputeCount,
        chargeback_count: chargebackCount,
        inquiry_count: inquiryCount,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,date" },
    );

  if (upsertErr) {
    throw new Error(`shop_daily_metrics upsert failed: ${upsertErr.message}`);
  }

  return {
    shopId,
    date: dateIso,
    orderCount,
    disputeCount,
    chargebackCount,
    inquiryCount,
  };
}

function nextDateIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Yesterday in UTC (`YYYY-MM-DD`). The most recent fully complete day. */
export function yesterdayUtcDateIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Build a list of YYYY-MM-DD strings for the last `days` UTC days
 *  ending at (and excluding) today — used for backfill. */
export function recentUtcDates(days: number, now: Date = new Date()): string[] {
  const dates: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

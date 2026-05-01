/**
 * 90-day backfill orchestration for shop_daily_metrics.
 *
 * Strategy (revised 2026-05-01): a single paginated orders-list
 * stream covers the full 90-day window in one Shopify call (typically
 * one page; high-volume shops paginate). We group orders locally by
 * UTC date, then write 90 daily rows in one upsert batch.
 *
 * This replaces the prior per-day fan-out (90 sequential
 * `snapshotShopDailyMetrics` calls), which had two issues:
 *   1. Shopify's `ordersCount` returned wrong counts for narrow
 *      `created_at:>=...Z created_at:<...Z` filters (verified bug —
 *      surasvenne window=7 vs per-day-summed=14).
 *   2. 90 sequential calls × ~500ms each ≈ 45s of Shopify time even
 *      on a quiet shop.
 *
 * Single-stream approach:
 *   - One paginated orders fetch for the 90-day window.
 *   - One disputes table read for the 90-day window.
 *   - 90 row upserts in one DB call.
 *
 * Test-order handling: orders with `test === true` are excluded from
 * the denominator. Disputes whose `order_gid` matches a test order
 * are excluded from the numerator. PRD: "Chargeback rate must
 * reflect real merchant activity only."
 */

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import {
  fetchOrdersInWindow,
  bucketOrdersByUtcDay,
  testOrderGidSet,
} from "@/lib/shopify/queries/ordersForSnapshot";
import { recentUtcDates } from "./snapshotShopDailyMetrics";

export const BACKFILL_DAYS = 90;

export interface BackfillResult {
  shopId: string;
  windowStart: string;
  windowEnd: string;
  daysWritten: number;
  ordersFetched: number;
  ordersAfterTestFilter: number;
  disputesInWindow: number;
  disputesAfterTestFilter: number;
}

export async function backfillShopDailyMetrics(
  shopId: string,
  opts: { correlationId?: string; days?: number } = {},
): Promise<BackfillResult> {
  const days = opts.days ?? BACKFILL_DAYS;
  const dates = recentUtcDates(days);
  // dates is newest-first; the window runs from the oldest date in
  // the list (inclusive) to the day after the newest (exclusive).
  const windowStart = dates[dates.length - 1];
  const windowEnd = (() => {
    const newest = new Date(`${dates[0]}T00:00:00Z`);
    newest.setUTCDate(newest.getUTCDate() + 1);
    return newest.toISOString().slice(0, 10);
  })();

  const session = await getShopBackgroundSession(shopId);

  // ── 1. Pull the full 90-day orders list in one paginated stream ─
  const orders = await fetchOrdersInWindow(
    { shopDomain: session.shopDomain, accessToken: session.accessToken },
    windowStart,
    windowEnd,
    { correlationId: opts.correlationId ?? `backfill-${shopId}` },
  );
  const orderBuckets = bucketOrdersByUtcDay(orders);
  const testGids = testOrderGidSet(orders);
  const realOrderCount = orders.length - testGids.size;

  // ── 2. Pull the 90-day disputes list ───────────────────────────
  const sb = getServiceClient();
  const startIso = `${windowStart}T00:00:00Z`;
  const endIso = `${windowEnd}T00:00:00Z`;
  const { data: disputeRows, error: disputeErr } = await sb
    .from("disputes")
    .select("id, phase, order_gid, initiated_at")
    .eq("shop_id", shopId)
    .gte("initiated_at", startIso)
    .lt("initiated_at", endIso);
  if (disputeErr) {
    throw new Error(`disputes lookup failed: ${disputeErr.message}`);
  }

  // Group disputes by UTC date, excluding those tied to test orders.
  type DisputeBucket = { dispute: number; chargeback: number; inquiry: number };
  const disputeBuckets = new Map<string, DisputeBucket>();
  let disputesAfterFilter = 0;
  for (const row of disputeRows ?? []) {
    if (row.order_gid && testGids.has(row.order_gid as string)) continue;
    disputesAfterFilter += 1;
    const initiated = String(row.initiated_at ?? "");
    if (!initiated) continue;
    const dateIso = initiated.slice(0, 10);
    if (dateIso < windowStart || dateIso >= windowEnd) continue;
    const bucket =
      disputeBuckets.get(dateIso) ?? { dispute: 0, chargeback: 0, inquiry: 0 };
    bucket.dispute += 1;
    if (row.phase === "chargeback") bucket.chargeback += 1;
    else if (row.phase === "inquiry") bucket.inquiry += 1;
    disputeBuckets.set(dateIso, bucket);
  }

  // ── 3. Build one row per UTC day in the window ─────────────────
  const nowIso = new Date().toISOString();
  const rowsToUpsert = dates.map((dateIso) => {
    const orderCount = orderBuckets.get(dateIso) ?? 0;
    const dBucket = disputeBuckets.get(dateIso) ?? {
      dispute: 0,
      chargeback: 0,
      inquiry: 0,
    };
    return {
      shop_id: shopId,
      date: dateIso,
      order_count: orderCount,
      dispute_count: dBucket.dispute,
      chargeback_count: dBucket.chargeback,
      inquiry_count: dBucket.inquiry,
      last_synced_at: nowIso,
    };
  });

  const { error: upsertErr } = await sb
    .from("shop_daily_metrics")
    .upsert(rowsToUpsert, { onConflict: "shop_id,date" });
  if (upsertErr) {
    throw new Error(`shop_daily_metrics bulk upsert failed: ${upsertErr.message}`);
  }

  return {
    shopId,
    windowStart,
    windowEnd,
    daysWritten: rowsToUpsert.length,
    ordersFetched: orders.length,
    ordersAfterTestFilter: realOrderCount,
    disputesInWindow: (disputeRows ?? []).length,
    disputesAfterTestFilter: disputesAfterFilter,
  };
}

/**
 * Enqueue a backfill job for a shop. Skips when:
 *   - A backfill job is already queued/running for this shop.
 *   - The shop already has any rows in shop_daily_metrics (treated as
 *     "already backfilled or actively maintained" — re-installs after
 *     uninstalls fall through here, which is correct: existing rows
 *     stay, missing days will be top-up by the daily cron).
 *
 * Returns the job ID, or null when skipped.
 */
export async function enqueueShopDailyMetricsBackfill(
  shopId: string,
): Promise<string | null> {
  const sb = getServiceClient();

  const { data: existingJob } = await sb
    .from("jobs")
    .select("id")
    .eq("shop_id", shopId)
    .eq("job_type", "backfill_shop_daily_metrics")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();

  if (existingJob) return null;

  const { count } = await sb
    .from("shop_daily_metrics")
    .select("date", { count: "exact", head: true })
    .eq("shop_id", shopId);

  if ((count ?? 0) > 0) return null;

  return enqueueJob({
    shopId,
    jobType: "backfill_shop_daily_metrics",
    entityId: shopId,
    priority: 90,
  });
}

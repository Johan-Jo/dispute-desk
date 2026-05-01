/**
 * 90-day backfill orchestration for shop_daily_metrics.
 *
 * Strategy: a single job per shop that loops through the last 90 UTC
 * days and calls `snapshotShopDailyMetrics` for each. A bulk job (vs.
 * 90 individual jobs) avoids the per-shop concurrency cap (1 job at a
 * time) which would otherwise stretch a backfill over ~3 hours.
 *
 * The handler is idempotent — already-snapshotted dates are skipped,
 * so retries on transient failures don't duplicate Shopify calls.
 *
 * Pacing: 200ms gap between dates to stay well clear of Shopify's
 * 50-points-per-second restore rate. 90 days × (~500ms call + 200ms
 * gap) ≈ 63s — fits comfortably under the worker's 300s `maxDuration`.
 *
 * PRD §6: backfill is required before the admin risk view shows
 * meaningful data. The cron continues to top up the trailing edge daily.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import {
  snapshotShopDailyMetrics,
  recentUtcDates,
} from "./snapshotShopDailyMetrics";

export const BACKFILL_DAYS = 90;
const BETWEEN_DATE_PAUSE_MS = 200;

export interface BackfillResult {
  shopId: string;
  attempted: number;
  skipped: number;
  succeeded: number;
  failed: number;
  failures: Array<{ date: string; error: string }>;
}

export async function backfillShopDailyMetrics(
  shopId: string,
  opts: { correlationId?: string; days?: number } = {},
): Promise<BackfillResult> {
  const days = opts.days ?? BACKFILL_DAYS;
  const dates = recentUtcDates(days);

  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("shop_daily_metrics")
    .select("date")
    .eq("shop_id", shopId)
    .in("date", dates);
  const existingDates = new Set((existing ?? []).map((r) => r.date));

  const todo = dates.filter((d) => !existingDates.has(d));

  const result: BackfillResult = {
    shopId,
    attempted: todo.length,
    skipped: dates.length - todo.length,
    succeeded: 0,
    failed: 0,
    failures: [],
  };

  for (const date of todo) {
    try {
      await snapshotShopDailyMetrics(shopId, date, {
        correlationId: opts.correlationId ?? `backfill-${shopId}`,
      });
      result.succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.failures.push({ date, error: message });
      // Don't abort — one bad day shouldn't kill the whole backfill.
      // The handler's `markJobFailed` retry path will revisit any
      // dates that failed (since they're now in `todo` again next run).
    }
    if (BETWEEN_DATE_PAUSE_MS > 0) {
      await new Promise((r) => setTimeout(r, BETWEEN_DATE_PAUSE_MS));
    }
  }

  return result;
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

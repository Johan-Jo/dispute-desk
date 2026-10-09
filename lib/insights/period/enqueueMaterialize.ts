/**
 * Enqueue `materialize_insights_months` for a shop
 * (docs/plans/insights-first-day-gaps.plan.md §3.3).
 *
 * Called by the events that can complete a new shop's inputs: the order
 * import finishing, a dispute sync succeeding, the fraud rollup finishing.
 * It enqueues only for a shop with a complete import and no month record yet,
 * so for every established shop it costs one count and does nothing.
 *
 * Never throws: it runs at the end of other jobs and must not fail them. The
 * nightly `calculate-ratios` cron reaches the same state if this is lost.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";

export const MATERIALIZE_JOB_TYPE = "materialize_insights_months";
/** Claimed after the jobs it depends on: sync_disputes (50), the fraud rollup
 *  (70), the order import (80) and the daily-metrics backfill (90). */
export const MATERIALIZE_JOB_PRIORITY = 95;

export async function enqueueMaterializeInsightsMonths(
  shopId: string,
  /** `unfinished`: the caller knows months are still missing (the cron, after
   *  a cut run), so the "no record yet" check is skipped. */
  opts: { unfinished?: boolean } = {},
): Promise<string | null> {
  try {
    const sb = getServiceClient();

    if (!opts.unfinished) {
      const { count, error } = await sb
        .from("ratio_snapshots")
        .select("period_month", { count: "exact", head: true })
        .eq("shop_id", shopId);
      if (error || (count ?? 0) > 0) return null;

      const { data: shop } = await sb
        .from("shops")
        .select("historical_import_status, uninstalled_at")
        .eq("id", shopId)
        .maybeSingle();
      if (!shop || shop.uninstalled_at || shop.historical_import_status !== "complete") return null;
    }

    const { data: existing } = await sb
      .from("jobs")
      .select("id")
      .eq("shop_id", shopId)
      .eq("job_type", MATERIALIZE_JOB_TYPE)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();
    if (existing) return null;

    return await enqueueJob({
      shopId,
      jobType: MATERIALIZE_JOB_TYPE,
      entityId: shopId,
      priority: MATERIALIZE_JOB_PRIORITY,
    });
  } catch (err) {
    console.warn(
      `[insights] materialize enqueue failed for ${shopId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

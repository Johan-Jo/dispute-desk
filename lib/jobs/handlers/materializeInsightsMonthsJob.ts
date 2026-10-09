/**
 * Job handler: materialize_insights_months
 *
 * Writes a shop's Insights month records as soon as its inputs are complete,
 * instead of leaving a new shop's page empty until the 02:00 cron
 * (docs/plans/insights-first-day-gaps.plan.md §3.3). Enqueued by the events
 * that can complete those inputs — see `enqueueMaterializeInsightsMonths`.
 *
 * No waiting logic: when the shop is not ready the handler returns and the
 * next event enqueues it again. A slice that wrote months and has more left
 * enqueues its own continuation; a slice that wrote nothing ends the chain.
 *
 * The nightly cron runs the same routine, so a lost job only costs time.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { alertOnce, maintainShopMonths, type MaintainShop } from "@/lib/insights/period/maintainShopMonths";
import { MATERIALIZE_JOB_PRIORITY, MATERIALIZE_JOB_TYPE } from "@/lib/insights/period/enqueueMaterialize";
import { statementMonth } from "@/lib/insights/period/months";
import { enqueueJob, type ClaimedJob } from "../claimJobs";

/** No new month is started after this. Measured 2026-10-09: about 5.6 s per
 *  month, so a 12-month window fits one slice. */
const SLICE_BUDGET_MS = 100_000;

export async function handleMaterializeInsightsMonths(job: ClaimedJob): Promise<void> {
  const sb = getServiceClient();
  const { data: shop, error } = await sb
    .from("shops")
    .select(
      "id, shop_domain, uninstalled_at, historical_import_status, historical_import_completed_at, historical_import_since_date",
    )
    .eq("id", job.shopId)
    .maybeSingle();
  if (error) throw new Error(`shop: ${error.message}`);
  if (!shop || shop.uninstalled_at || shop.historical_import_status !== "complete") return;

  const now = new Date();
  try {
    const result = await maintainShopMonths(sb, shop as MaintainShop, now, { budgetMs: SLICE_BUDGET_MS });
    if (result.skipped) return;
    if (result.remaining > 0 && result.written.length > 0) {
      // Not deduped: this job is still `running`, so a "queued or running"
      // check would cancel its own continuation.
      await enqueueJob({
        shopId: job.shopId,
        jobType: MATERIALIZE_JOB_TYPE,
        entityId: job.shopId,
        priority: MATERIALIZE_JOB_PRIORITY,
      });
    }
  } catch (err) {
    // Later syncs enqueue this job again, so a month that can never be
    // computed would otherwise fail silently every hour.
    if (job.attempts >= job.maxAttempts) {
      const message = err instanceof Error ? err.message : String(err);
      await alertOnce(sb, shop, "materialize_failed", statementMonth(now), {
        logTag: "insights-materialize-failed",
        subject: `[Insights] ${shop.shop_domain}: month records could not be written`,
        text: `materialize_insights_months failed on its last attempt for ${shop.shop_domain}: ${message}. Its Insights page stays without month records until this is fixed.`,
      }).catch(() => {});
    }
    throw err;
  }
}

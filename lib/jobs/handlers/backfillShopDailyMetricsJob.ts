/**
 * Job handler: backfill_shop_daily_metrics
 *
 * Single-job, multi-day backfill. Delegates to the orchestrator in
 * lib/disputes/backfillShopDailyMetrics.ts which fetches the entire
 * 90-day orders + disputes window in one paginated stream and writes
 * one bulk upsert. Failures throw and let the standard job-runner
 * retry path re-execute the whole backfill.
 */

import { backfillShopDailyMetrics } from "@/lib/disputes/backfillShopDailyMetrics";
import type { ClaimedJob } from "../claimJobs";

export async function handleBackfillShopDailyMetrics(
  job: ClaimedJob,
): Promise<void> {
  await backfillShopDailyMetrics(job.shopId, {
    correlationId: `job-${job.id}`,
  });
}

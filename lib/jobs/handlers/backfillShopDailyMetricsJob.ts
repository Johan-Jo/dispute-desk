/**
 * Job handler: backfill_shop_daily_metrics
 *
 * Single-job, multi-day backfill. Delegates to the orchestrator in
 * lib/disputes/backfillShopDailyMetrics.ts which loops through the
 * last 90 UTC days, skipping already-snapshotted dates.
 */

import { backfillShopDailyMetrics } from "@/lib/disputes/backfillShopDailyMetrics";
import type { ClaimedJob } from "../claimJobs";

export async function handleBackfillShopDailyMetrics(
  job: ClaimedJob,
): Promise<void> {
  const result = await backfillShopDailyMetrics(job.shopId, {
    correlationId: `job-${job.id}`,
  });
  // If any date failed, surface as a job failure so the retry path
  // re-runs the orchestrator (which will skip the dates that did
  // succeed). All-success exits cleanly.
  if (result.failed > 0) {
    throw new Error(
      `Backfill: ${result.succeeded}/${result.attempted} succeeded; ${result.failed} failed. First failure: ${result.failures[0]?.date} — ${result.failures[0]?.error}`,
    );
  }
}

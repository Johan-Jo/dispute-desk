/**
 * Job handler: snapshot_shop_daily_metrics
 *
 * Single-day snapshot. The job's `entity_id` carries the date in
 * `YYYY-MM-DD` form (the column is TEXT, not UUID). When `entity_id`
 * is absent, the handler defaults to "yesterday" UTC — the cron
 * enqueues with an explicit date but the fallback keeps manual /
 * admin-triggered re-snapshots simple.
 *
 * Runs in the standard `/api/jobs/worker` loop. Backfill is achieved
 * by enqueueing one job per date — keeps each run cheap (~1 Shopify
 * call) and lets the worker's per-shop concurrency cap throttle the
 * fan-out so a 90-day backfill doesn't saturate the rate budget.
 */

import {
  snapshotShopDailyMetrics,
  yesterdayUtcDateIso,
} from "@/lib/disputes/snapshotShopDailyMetrics";
import type { ClaimedJob } from "../claimJobs";

export async function handleSnapshotShopDailyMetrics(job: ClaimedJob): Promise<void> {
  const dateIso =
    job.entityId && /^\d{4}-\d{2}-\d{2}$/.test(job.entityId)
      ? job.entityId
      : yesterdayUtcDateIso();

  await snapshotShopDailyMetrics(job.shopId, dateIso, {
    correlationId: `job-${job.id}`,
  });
}

/**
 * Job handler: backfill_fraud_daily_metrics
 *
 * Bulk-backfill all daily rollups for a shop. Triggered after the
 * order-backfill orchestrator flips `historical_import_status` to
 * 'complete' so the embedded dashboard's window selectors (30d/90d/
 * 365d/all) have rollup data the moment the banner unlocks.
 *
 * Bounded by the 300s `maxDuration` like its siblings. For a 60-day
 * window that's 60 Postgres aggregations — well inside budget. For
 * `read_all_orders` shops with multi-year history this can stretch;
 * if it ever times out, the worker's retry path will re-run from
 * scratch (the snapshot is upsert-idempotent so retries are cheap).
 */

import { backfillFraudDailyMetrics } from "@/lib/disputes/snapshotFraudDailyMetrics";
import type { ClaimedJob } from "../claimJobs";

export async function handleBackfillFraudDailyMetrics(
  job: ClaimedJob,
): Promise<void> {
  await backfillFraudDailyMetrics(job.shopId);
}

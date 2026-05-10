/**
 * Job handler: snapshot_fraud_daily_metrics
 *
 * Single-day fraud-rollup snapshot. The job's `entity_id` carries the
 * date in `YYYY-MM-DD` form (column is TEXT, not UUID). When
 * `entity_id` is absent, defaults to yesterday UTC — mirrors the
 * snapshot_shop_daily_metrics convention so manual / admin-triggered
 * re-snapshots stay simple.
 */

import {
  snapshotFraudDailyMetrics,
  fraudYesterdayUtcDateIso,
} from "@/lib/disputes/snapshotFraudDailyMetrics";
import type { ClaimedJob } from "../claimJobs";

export async function handleSnapshotFraudDailyMetrics(
  job: ClaimedJob,
): Promise<void> {
  const dateIso =
    job.entityId && /^\d{4}-\d{2}-\d{2}$/.test(job.entityId)
      ? job.entityId
      : fraudYesterdayUtcDateIso();

  await snapshotFraudDailyMetrics(job.shopId, dateIso);
}

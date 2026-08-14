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
import { ShopUnavailableError } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { getServiceClient } from "@/lib/supabase/server";
import type { ClaimedJob } from "../claimJobs";
import type { JobResult } from "../claimJobs";

export async function handleSnapshotShopDailyMetrics(job: ClaimedJob): Promise<JobResult> {
  const dateIso =
    job.entityId && /^\d{4}-\d{2}-\d{2}$/.test(job.entityId)
      ? job.entityId
      : yesterdayUtcDateIso();

  try {
    await snapshotShopDailyMetrics(job.shopId, dateIso, {
      correlationId: `job-${job.id}`,
    });
    return { ok: true };
  } catch (err) {
    /* ── A DELETED STORE IS TERMINAL, AND SHOULD BE RECORDED AS ONE ────
     *
     * Returned `Promise<void>` before, so every throw was retriable and this
     * job re-queued daily against stores Shopify no longer serves. Measured
     * 2026-08-13: `6mjjvm-tc` and `xxda51-v1` had 34 failed runs EACH, one per
     * day since they vanished, both still `uninstalled_at: null` in our
     * records so nothing else knew either.
     *
     * The cost was noise rather than money — neither holds a dispute — but 68
     * fake failures are exactly what would hide a real one.
     *
     * Marking `uninstalled_at` stops the CRON enqueueing it again, not just
     * this run from retrying: the daily selector already skips uninstalled
     * shops, so without the write the job returns non-retriable today and is
     * re-created tomorrow. The write is best-effort — failing to record it
     * must not turn a terminal outcome into a retriable one. */
    if (err instanceof ShopUnavailableError) {
      try {
        await getServiceClient()
          .from("shops")
          .update({ uninstalled_at: new Date().toISOString() })
          .eq("id", job.shopId)
          .is("uninstalled_at", null);
      } catch (markErr) {
        console.error(
          `[snapshot] could not mark shop ${job.shopId} uninstalled`,
          markErr,
        );
      }
      return { ok: false, retriable: false, reason: `shop_unavailable: ${err.message}` };
    }
    throw err;
  }
}

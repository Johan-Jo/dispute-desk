/**
 * Job handler: sync_disputes
 *
 * Delegates to the shared syncDisputes() service.
 */

import { syncDisputes } from "@/lib/disputes/syncDisputes";
import type { ClaimedJob } from "../claimJobs";

export async function handleSyncDisputes(job: ClaimedJob): Promise<void> {
  const result = await syncDisputes(job.shopId, {
    triggerAutomation: true,
    correlationId: `job-${job.id}`,
  });

  // syncDisputes COLLECTS errors rather than throwing: a failed Shopify
  // call lands in `result.errors` and the function returns normally. The
  // handler used to ignore the return value entirely, so a sync that
  // fetched nothing at all still marked the job `succeeded`.
  //
  // That is how a 20-hour outage stayed invisible on 6a8848-dd
  // (2026-08-30): every hourly run logged "succeeded" while its expired
  // token made ~50% of them fetch zero disputes. Throwing here lets the
  // dispatcher record the failure, retry, and surface it — a sync that
  // synced nothing is not a success.
  if (result.errors.length > 0) {
    throw new Error(
      `sync_disputes completed with ${result.errors.length} error(s): ` +
        result.errors.slice(0, 5).join(" | "),
    );
  }
}

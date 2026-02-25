/**
 * Job handler: sync_disputes
 *
 * Delegates to the shared syncDisputes() service.
 */

import { syncDisputes } from "@/lib/disputes/syncDisputes";
import type { ClaimedJob } from "../claimJobs";

export async function handleSyncDisputes(job: ClaimedJob): Promise<void> {
  await syncDisputes(job.shopId, {
    triggerAutomation: true,
    correlationId: `job-${job.id}`,
  });
}

/**
 * Job handler: reconcile_missing_order (PR-B)
 *
 * Triggered by /api/cron/orders-reconciliation when the daily sweep
 * finds an order Shopify created in the last ~26h that doesn't exist
 * in `shopify_orders` (webhook delivery loss, pre-PR-A historical gap).
 *
 * Resolves to `normalizeOrderIngest` — same GraphQL fetch + normalize
 * + hash-gated persist as the webhook path. Idempotent: re-running
 * after a successful first pass produces `skipped_unchanged`.
 *
 * The order GID is stashed on the job's `entity_id` column.
 */

import type { ClaimedJob } from "@/lib/jobs/claimJobs";
import { normalizeOrderIngest } from "@/lib/shopify/orderIngest";

export async function handleReconcileMissingOrder(
  job: ClaimedJob,
): Promise<void> {
  const orderGid = job.entityId;
  if (!orderGid) {
    throw new Error("reconcile_missing_order: entity_id (order GID) missing");
  }
  await normalizeOrderIngest(job.shopId, orderGid, {
    correlationId: `reconcile-${job.id}`,
  });
}

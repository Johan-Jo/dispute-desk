/**
 * Job handler: backfill_shop_orders
 *
 * Walks the Shopify orders connection for the shop's historical
 * window, persisting each order + its risk snapshot to the
 * fraud-intelligence schema (`shopify_orders`,
 * `shopify_order_risk_assessments`).
 *
 * Resume model: when the orchestrator hits its soft time budget
 * before walking the entire window, it returns the GraphQL cursor
 * for the next page. The handler re-enqueues a new job with that
 * cursor stashed in `entity_id`. The worker's per-shop concurrency
 * cap (1) prevents the resumed job from racing the orchestrator's
 * own progress writes.
 *
 * Failure behavior: any throw inside the orchestrator marks the
 * shops row `historical_import_status = 'failed'` with the last
 * error message, then re-throws so the worker's standard retry
 * path can re-claim. The merchant-facing UI surfaces the failure
 * via a "We hit a snag analyzing your orders" state.
 */

import { backfillShopOrders } from "@/lib/disputes/backfillOrders";
import { enqueueJob, type ClaimedJob } from "../claimJobs";
import { getServiceClient } from "@/lib/supabase/server";

export async function handleBackfillShopOrders(job: ClaimedJob): Promise<void> {
  const cursor = job.entityId && job.entityId.length > 0 ? job.entityId : null;
  try {
    const result = await backfillShopOrders(job.shopId, {
      cursor,
      correlationId: `job-${job.id}`,
    });
    if (result.status === "continue" && result.nextCursor) {
      // Re-enqueue with the next cursor. Same priority so resumption
      // doesn't starve other work.
      await enqueueJob({
        shopId: job.shopId,
        jobType: "backfill_shop_orders",
        entityId: result.nextCursor,
        priority: 80,
      });
    }
  } catch (e) {
    // Surface failure on the shops row so the embedded dashboard
    // can render the failed state. Re-throw to let the worker's
    // retry path handle exponential backoff.
    const sb = getServiceClient();
    await sb
      .from("shops")
      .update({
        historical_import_status: "failed",
      })
      .eq("id", job.shopId);
    throw e;
  }
}

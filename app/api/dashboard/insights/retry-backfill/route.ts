/**
 * POST /api/dashboard/insights/retry-backfill
 *
 * Merchant-triggered retry for the historical-orders backfill when the
 * shop's `historical_import_status` is `failed`. Flips the status back
 * to `not_started` and re-enqueues the job. Idempotent on the enqueue
 * side: enqueueShopOrdersBackfill skips when a job is already
 * queued/running.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { enqueueShopOrdersBackfill } from "@/lib/disputes/backfillOrders";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const shopId = await extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: shop } = await sb
    .from("shops")
    .select("historical_import_status")
    .eq("id", shopId)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }

  // Only allow retry from a terminal failed state. complete/running/queued
  // shouldn't trigger another run from this endpoint.
  if (shop.historical_import_status !== "failed") {
    return NextResponse.json(
      { error: "not_retryable", currentStatus: shop.historical_import_status },
      { status: 409 },
    );
  }

  // Reset the column so enqueueShopOrdersBackfill + the worker can pick
  // up cleanly. Also clears stale counters so the merchant sees fresh
  // progress instead of the previous failed run's partial counts.
  await sb
    .from("shops")
    .update({
      historical_import_status: "not_started",
      historical_import_orders_processed: 0,
      historical_import_orders_total: null,
      historical_import_completed_at: null,
      historical_import_progress_pct: 0,
    })
    .eq("id", shopId);

  const jobId = await enqueueShopOrdersBackfill(shopId);

  return NextResponse.json({ ok: true, jobId });
}

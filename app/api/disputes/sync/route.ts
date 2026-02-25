import { NextRequest, NextResponse } from "next/server";
import { syncDisputes } from "@/lib/disputes/syncDisputes";

/**
 * POST /api/disputes/sync
 * Body: { shop_id }
 *
 * Runs a full dispute sync for the given shop (synchronous, not job-based).
 * For async/background sync, enqueue a sync_disputes job instead.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const shopId = body.shop_id;

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  try {
    const result = await syncDisputes(shopId, {
      triggerAutomation: true,
      correlationId: `manual-sync-${Date.now()}`,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

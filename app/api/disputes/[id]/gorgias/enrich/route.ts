/**
 * POST /api/disputes/:id/gorgias/enrich
 *
 * Manual "Refresh from Gorgias" — enqueues an enrichment run for the
 * dispute. All idempotency guards live in `enqueueGorgiasEnrichment`
 * (connected check, pending-job guard, one-active-run partial unique
 * index); a fresh trigger after a completed run legitimately creates
 * run_number + 1.
 *
 * 202 when enqueued; 200 with `enqueued:false` + reason when a run/job is
 * already pending (the workspace poll will surface its progress); 409
 * when Gorgias isn't connected.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { enqueueGorgiasEnrichment } from "@/lib/integrations/gorgias/enqueueEnrichment";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: disputeId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  // Ownership check — the enqueue helper trusts its caller on this.
  const sb = getServiceClient();
  const { data: dispute } = await sb
    .from("disputes")
    .select("id")
    .eq("id", disputeId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const result = await enqueueGorgiasEnrichment({
    shopId,
    disputeId,
    trigger: "manual",
  });

  if (result.enqueued) {
    return NextResponse.json(
      { ok: true, enqueued: true, runId: result.runId },
      { status: 202 },
    );
  }
  if (result.reason === "not_connected") {
    return NextResponse.json(
      { ok: false, enqueued: false, reason: result.reason },
      { status: 409 },
    );
  }
  // job_already_pending / run_already_active / enqueue_failed —
  // the poll surfaces live state; nothing for the merchant to fix.
  return NextResponse.json({
    ok: result.reason !== "enqueue_failed",
    enqueued: false,
    reason: result.reason,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { logAuditEvent } from "@/lib/audit/logEvent";

/**
 * POST /api/packs/:packId/render-pdf
 *
 * Enqueues a render_pdf job. Returns immediately for UI polling.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();

  const { data: pack, error } = await db
    .from("evidence_packs")
    .select("id, shop_id")
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const jobId = await enqueueJob({
    shopId: pack.shop_id,
    jobType: "render_pdf",
    entityId: pack.id,
  });

  await logAuditEvent({
    shopId: pack.shop_id,
    packId: pack.id,
    actorType: "merchant",
    eventType: "job_queued",
    eventPayload: { jobId, jobType: "render_pdf" },
  });

  return NextResponse.json(
    { jobId, status: "queued" },
    { status: 202 }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { logAuditEvent } from "@/lib/audit/logEvent";

/**
 * POST /api/disputes/:id/packs
 *
 * Creates a new evidence pack in "queued" state and enqueues a build_pack job.
 * Returns immediately with packId + jobId for UI polling.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: disputeId } = await params;
  const db = getServiceClient();

  const { data: dispute, error: dErr } = await db
    .from("disputes")
    .select("id, shop_id")
    .eq("id", disputeId)
    .single();

  if (dErr || !dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  const { data: pack, error: pErr } = await db
    .from("evidence_packs")
    .insert({
      shop_id: dispute.shop_id,
      dispute_id: dispute.id,
      status: "queued",
    })
    .select("id")
    .single();

  if (pErr || !pack) {
    return NextResponse.json(
      { error: `Failed to create pack: ${pErr?.message}` },
      { status: 500 }
    );
  }

  const jobId = await enqueueJob({
    shopId: dispute.shop_id,
    jobType: "build_pack",
    entityId: pack.id,
  });

  await logAuditEvent({
    shopId: dispute.shop_id,
    disputeId: dispute.id,
    packId: pack.id,
    actorType: "merchant",
    eventType: "job_queued",
    eventPayload: { jobId, jobType: "build_pack" },
  });

  return NextResponse.json(
    { packId: pack.id, jobId, status: "queued" },
    { status: 202 }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/disputes/:id/packs
 *
 * Enqueues a build_pack job for the dispute. Returns 202 with packId + jobId.
 * If an active (non-failed, non-archived) pack already exists, returns it instead.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: disputeId } = await params;
  const db = getServiceClient();

  const { data: dispute } = await db
    .from("disputes")
    .select("id, shop_id, reason")
    .eq("id", disputeId)
    .single();

  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }

  // Check for existing active pack
  const { data: existing } = await db
    .from("evidence_packs")
    .select("id, status, completeness_score")
    .eq("dispute_id", disputeId)
    .not("status", "in", '("failed","archived")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        packId: existing.id,
        status: existing.status,
        completenessScore: existing.completeness_score,
        message: "Active pack already exists for this dispute",
      },
      { status: 200 }
    );
  }

  // Create pack + enqueue job
  const { data: pack, error: packErr } = await db
    .from("evidence_packs")
    .insert({
      shop_id: dispute.shop_id,
      dispute_id: disputeId,
      status: "queued",
      created_by: "manual",
    })
    .select("id")
    .single();

  if (packErr || !pack) {
    return NextResponse.json(
      { error: `Failed to create pack: ${packErr?.message}` },
      { status: 500 }
    );
  }

  const { data: job, error: jobErr } = await db
    .from("jobs")
    .insert({
      shop_id: dispute.shop_id,
      job_type: "build_pack",
      entity_id: pack.id,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json(
      { error: `Failed to enqueue job: ${jobErr?.message}` },
      { status: 500 }
    );
  }

  await db.from("audit_events").insert({
    shop_id: dispute.shop_id,
    dispute_id: disputeId,
    pack_id: pack.id,
    actor_type: "merchant",
    event_type: "job_queued",
    event_payload: { jobId: job.id, trigger: "manual_generate" },
  });

  return NextResponse.json(
    { packId: pack.id, jobId: job.id },
    { status: 202 }
  );
}

/**
 * GET /api/disputes/:id/packs
 *
 * List all evidence packs for a dispute.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: disputeId } = await params;
  const db = getServiceClient();

  const { data: packs } = await db
    .from("evidence_packs")
    .select("id, status, completeness_score, created_by, created_at, updated_at")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ packs: packs ?? [] });
}

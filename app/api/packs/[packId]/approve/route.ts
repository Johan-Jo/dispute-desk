import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

interface RouteParams {
  params: Promise<{ packId: string }>;
}

/**
 * POST /api/packs/:packId/approve
 * Body: { user_id } (portal user or merchant context)
 *
 * Approves a pack for auto-save, then enqueues a save_to_shopify job.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { packId } = await params;
  const body = await req.json();
  const userId = body.user_id;

  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, completeness_score")
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  if (pack.status === "saved_to_shopify") {
    return NextResponse.json(
      { error: "Pack already saved to Shopify" },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  await sb
    .from("evidence_packs")
    .update({
      approved_for_save_at: now,
      approved_by_user_id: userId ?? null,
      updated_at: now,
    })
    .eq("id", packId);

  const { data: job, error: jobErr } = await sb
    .from("jobs")
    .insert({
      shop_id: pack.shop_id,
      job_type: "save_to_shopify",
      entity_id: packId,
    })
    .select("id")
    .single();

  if (jobErr) {
    return NextResponse.json(
      { error: `Failed to enqueue save: ${jobErr.message}` },
      { status: 500 }
    );
  }

  await sb.from("audit_events").insert({
    shop_id: pack.shop_id,
    dispute_id: pack.dispute_id,
    pack_id: packId,
    actor_type: userId ? "merchant" : "system",
    actor_id: userId ?? null,
    event_type: "manual_approved_for_save",
    event_payload: {
      completeness_score: pack.completeness_score,
      job_id: job.id,
    },
  });

  return NextResponse.json(
    { message: "Approved and enqueued", jobId: job.id },
    { status: 202 }
  );
}

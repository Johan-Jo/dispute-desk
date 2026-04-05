import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";

/**
 * POST /api/packs/:packId/save-to-shopify
 *
 * Enqueues a save_to_shopify job. The actual Shopify mutation
 * runs in the job handler to isolate failures and enable retry.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, completeness_score")
    .eq("id", packId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  // Server-side completeness gate — do not trust client
  const score = pack.completeness_score ?? 0;
  if (pack.status === "blocked" || score === 0) {
    return NextResponse.json(
      { error: "PACK_INCOMPLETE", message: "Pack has no evidence collected. Add evidence before saving to Shopify." },
      { status: 422 }
    );
  }

  const body = await req.json().catch(() => ({})) as { confirmLowCompleteness?: boolean };
  if (score < 80 && !body.confirmLowCompleteness) {
    return NextResponse.json(
      { error: "PACK_LOW_COMPLETENESS", score, message: "Pack completeness is below 80%. Send confirmLowCompleteness: true to override." },
      { status: 422 }
    );
  }

  const { data: dispute } = await sb
    .from("disputes")
    .select("id, dispute_evidence_gid")
    .eq("id", pack.dispute_id)
    .single();

  if (!dispute?.dispute_evidence_gid) {
    return NextResponse.json(
      { error: "No dispute_evidence_gid found. Cannot save to Shopify." },
      { status: 400 }
    );
  }

  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "save_to_shopify",
    entity_id: packId,
  });

  if (jobErr) {
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  await sb
    .from("evidence_packs")
    .update({ status: "saving", updated_at: new Date().toISOString() })
    .eq("id", packId);

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "evidence_saved_to_shopify",
    eventPayload: { trigger: "manual", queued: true },
  });

  return NextResponse.json({ queued: true, packId }, { status: 202 });
}

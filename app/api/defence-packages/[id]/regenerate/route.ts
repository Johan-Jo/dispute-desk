/**
 * POST /api/defence-packages/:id/regenerate
 *
 * Trigger a fresh draft at version=N+1. Force-new even if the evidence
 * hash matches — matches the plan's "regeneration always bumps version"
 * decision.
 *
 * The new draft references the same source_pack_id. If a prior draft
 * exists, this route marks it stale (a draft → stale transition is
 * allowed by the immutability trigger).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();
  const { data: existing, error } = await sb
    .from("defence_packages")
    .select(
      "id, dispute_id, shop_id, source_pack_id, version, status, evidence_hash, reason_code_module",
    )
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();
  if (error || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Find the latest row for the dispute to compute the next version.
  const { data: latest } = await sb
    .from("defence_packages")
    .select("version, status")
    .eq("dispute_id", existing.dispute_id)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  const nextVersion = (latest?.version ?? existing.version) + 1;

  // Mark the current draft (if any) stale.
  if (existing.status === "draft") {
    await sb
      .from("defence_packages")
      .update({ status: "stale", updated_at: new Date().toISOString() })
      .eq("id", id);
    await logAuditEvent({
      shopId: existing.shop_id,
      disputeId: existing.dispute_id,
      packId: existing.source_pack_id,
      actorType: "merchant",
      eventType: "defence_package_stale",
      eventPayload: {
        packageId: id,
        version: existing.version,
        trigger: "regenerate",
      },
    });
  }

  const { data: inserted, error: insertErr } = await sb
    .from("defence_packages")
    .insert({
      dispute_id: existing.dispute_id,
      shop_id: existing.shop_id,
      source_pack_id: existing.source_pack_id,
      version: nextVersion,
      status: "draft",
      generated_by: "merchant",
      evidence_hash: existing.evidence_hash,
      reason_code_module: existing.reason_code_module,
    })
    .select("id, version")
    .single();
  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: `Insert failed: ${insertErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  await sb.from("jobs").insert({
    shop_id: existing.shop_id,
    job_type: "build_defence_package",
    entity_id: inserted.id,
  });

  await logAuditEvent({
    shopId: existing.shop_id,
    disputeId: existing.dispute_id,
    packId: existing.source_pack_id,
    actorType: "merchant",
    eventType: "defence_package_regenerated",
    eventPayload: {
      packageId: inserted.id,
      version: inserted.version,
      predecessorId: id,
    },
  });

  return NextResponse.json({
    ok: true,
    packageId: inserted.id,
    version: inserted.version,
  });
}

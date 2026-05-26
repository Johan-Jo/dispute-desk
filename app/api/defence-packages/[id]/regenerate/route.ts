/**
 * POST /api/defence-packages/:id/regenerate
 *
 * Merchant-facing "Regenerate draft" entry point. Rebuilds the
 * underlying evidence pack first, which then automatically chains to
 * a fresh defence-package draft via `maybeEnqueueDefencePackage` on
 * pack-build success.
 *
 * Two-step flow:
 *   1. Mark the current draft stale (if any) for clean audit trail.
 *   2. Enqueue a `build_pack` job on the source_pack_id. The pack
 *      handler runs every source collector — including fraudRiskSource,
 *      which now also persists the Shopify risk assessment via
 *      `lib/packs/buildPack.ts:persistRiskAssessmentIfMissing` — and
 *      then enqueues the defence-package build for us.
 *
 * Why this matters (2026-05-19): before this change, this route
 * directly enqueued `build_defence_package`, which reads the existing
 * `pack_json.sections` and never re-ran the source collectors. As a
 * result, evidence captured AFTER the original pack build (Shopify
 * risk assessments for post-backfill orders, new uploads, freshly
 * confirmed delivery, etc.) was invisible to subsequent regenerates.
 * The fix is to rebuild the pack first; defence regeneration follows
 * for free.
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
      "id, dispute_id, shop_id, source_pack_id, version, status",
    )
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();
  if (error || !existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Mark the current draft stale so the merchant's UI immediately
  // reflects "regenerating" state. The actual new draft will be
  // inserted by `maybeEnqueueDefencePackage` once the pack rebuild
  // completes.
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

  // Enqueue a pack rebuild. buildPackJob runs every source collector
  // (capturing fresh risk assessments / uploads / etc.) and then
  // automatically chains to maybeEnqueueDefencePackage to create the
  // next draft against the refreshed pack_json.
  await sb.from("jobs").insert({
    shop_id: existing.shop_id,
    job_type: "build_pack",
    entity_id: existing.source_pack_id,
  });

  await logAuditEvent({
    shopId: existing.shop_id,
    disputeId: existing.dispute_id,
    packId: existing.source_pack_id,
    actorType: "merchant",
    eventType: "defence_package_regenerated",
    eventPayload: {
      previousPackageId: id,
      previousVersion: existing.version,
      trigger: "merchant_regenerate",
      mode: "pack_rebuild_then_defence_regenerate",
    },
  });

  return NextResponse.json({
    ok: true,
    // The next draft's id/version aren't known until the pack rebuild
    // completes and maybeEnqueueDefencePackage inserts the row. The
    // client picks it up via the workspace endpoint's `defencePackage`
    // field, refreshed by the workspace hook's 4s poll.
    queued: true,
    previousPackageId: id,
    previousVersion: existing.version,
  });
}

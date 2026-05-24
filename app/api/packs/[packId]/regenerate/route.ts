/**
 * POST /api/packs/:packId/regenerate
 *
 * Resubmission Window: the merchant has uploaded new evidence after the
 * pack was already saved to Shopify and accepted the modal prompt to
 * regenerate the defence package. This endpoint enqueues the existing
 * `build_pack` job, which downstream chains through `buildPack` →
 * `maybeEnqueueDefencePackage` (new draft at version+1) →
 * `build_defence_package` → finalize → `save_to_shopify` (overwrites
 * the prior PDF GID on Shopify).
 *
 * Hard guards before enqueue:
 *   - 409 WINDOW_CLOSED        if disputes.submission_state = 'submitted_confirmed'
 *   - 409 INVALID_REGENERATE_WINDOW if dispute is missing OR
 *                              submission_state != 'saved_to_shopify'
 *
 * Concurrency: if the pack is already in an in-flight state (queued /
 * building / saving / saved_to_shopify_unverified), do NOT enqueue a
 * duplicate `build_pack` job. Set `rebuild_pending = true` instead; the
 * tail of `saveToShopifyJob` will enqueue a fresh build_pack after the
 * current save cycle settles.
 *
 * The endpoint never pre-flips `evidence_packs.status` to `queued`. The
 * previous Shopify save is canonical until the new one verifies; the
 * worker (`buildPackJob`) flips status to `building` when it picks up.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";

/**
 * Pack states where another build_pack/save_to_shopify cycle is already
 * running for this entity. The endpoint coalesces against these instead
 * of enqueueing a second job.
 *
 * NOT included: `saved_to_shopify_verified` (the canonical "open
 * window" state we expect when a regenerate is requested) and `ready`,
 * `failed`, `archived` (terminal-non-active).
 */
const IN_FLIGHT_PACK_STATUSES = new Set<string>([
  "queued",
  "building",
  "saving",
  "saved_to_shopify_unverified",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const db = getServiceClient();

  const { data: pack } = await db
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (!pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }
  if (!pack.dispute_id) {
    return NextResponse.json(
      {
        error: "INVALID_REGENERATE_WINDOW",
        message: "Library packs cannot be regenerated.",
      },
      { status: 409 },
    );
  }

  const { data: dispute } = await db
    .from("disputes")
    .select("submission_state, submitted_at")
    .eq("id", pack.dispute_id)
    .single();
  const submissionState = (dispute?.submission_state as string | null) ?? null;
  const submittedAt = (dispute?.submitted_at as string | null) ?? null;

  if (submissionState === "submitted_confirmed") {
    return NextResponse.json(
      {
        error: "WINDOW_CLOSED",
        message:
          "Shopify has already forwarded this dispute evidence to the bank, so the defence package can no longer be regenerated.",
        submittedAt,
      },
      { status: 409 },
    );
  }

  if (submissionState !== "saved_to_shopify") {
    return NextResponse.json(
      {
        error: "INVALID_REGENERATE_WINDOW",
        message:
          "This dispute has not been saved to Shopify yet. Regenerate is only available after the first save.",
        currentState: submissionState,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const packStatus = pack.status as string;

  // Coalesce: another build/save cycle is already running. Mark
  // rebuild_pending so saveToShopifyJob's tail enqueues a fresh
  // build_pack after the current cycle settles. Do NOT enqueue a
  // duplicate job here.
  if (IN_FLIGHT_PACK_STATUSES.has(packStatus)) {
    await db
      .from("evidence_packs")
      .update({ rebuild_pending: true, updated_at: now })
      .eq("id", packId);

    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "merchant",
      eventType: "pack_regenerate_requested",
      eventPayload: {
        trigger: "post_save_evidence_upload",
        coalesced: true,
        previousStatus: packStatus,
      },
    });

    return NextResponse.json(
      { status: "pending", coalesced: true },
      { status: 202 },
    );
  }

  // Idle path. Pack is at `saved_to_shopify_verified` (or another
  // terminal-open state). Set the flag and enqueue. Do NOT flip
  // evidence_packs.status — the prior Shopify save is canonical until
  // the new one verifies. buildPackJob will flip to 'building' on pickup
  // and clear rebuild_pending atomically.
  await db
    .from("evidence_packs")
    .update({ rebuild_pending: true, updated_at: now })
    .eq("id", packId);

  const { error: jobErr } = await db.from("jobs").insert({
    shop_id: pack.shop_id,
    job_type: "build_pack",
    entity_id: packId,
  });
  if (jobErr) {
    // Roll back the flag so the UI doesn't get stuck "regenerating"
    // with no worker to clear it.
    await db
      .from("evidence_packs")
      .update({ rebuild_pending: false, updated_at: new Date().toISOString() })
      .eq("id", packId);
    return NextResponse.json(
      { error: `Failed to enqueue regenerate: ${jobErr.message}` },
      { status: 500 },
    );
  }

  await logAuditEvent({
    shopId: pack.shop_id,
    disputeId: pack.dispute_id,
    packId,
    actorType: "merchant",
    eventType: "pack_regenerate_requested",
    eventPayload: {
      trigger: "post_save_evidence_upload",
      coalesced: false,
      previousStatus: packStatus,
    },
  });

  return NextResponse.json(
    { status: "regenerating", coalesced: false },
    { status: 200 },
  );
}

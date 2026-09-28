import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  preflightBlocks,
  preflightCandidate,
  preflightHttpRefusal,
  preflightLatestCandidate,
  preflightReasons,
} from "@/lib/defence/packageSafety";
import { isStaleCycle } from "@/lib/disputes/responseCycle";
import { BANK_CLAIM_DISPUTE_COLUMNS, bankClaimBlocksFiling, bankClaimInputFromRow } from "@/lib/disputes/bankClaim";

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
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const body = await req.json();
  const userId = body.user_id;

  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, completeness_score, response_cycle")
    .eq("id", packId)
    .eq("shop_id", shopId)
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

  // Hard status gate. Only a successfully built pack (status === "ready")
  // can be approved for save. Packs in "failed", "queued", "building",
  // "saving", "saved_to_shopify*", or "save_failed" must not be
  // approvable — their evidence-derived fields are either stale or invalid.
  if (pack.status !== "ready") {
    return NextResponse.json(
      {
        error: "PACK_NOT_READY",
        status: pack.status,
        message: "Pack is not in an approvable state. Only successfully built packs can be approved.",
      },
      { status: 409 }
    );
  }

  // Response-cycle guard: a pack from an earlier cycle answered a request
  // Shopify has since replaced (reopen, or inquiry → chargeback). Approving
  // it would schedule the old response for the new round.
  if (pack.dispute_id) {
    const { data: disputeRow } = await sb
      .from("disputes")
      .select(BANK_CLAIM_DISPUTE_COLUMNS)
      .eq("id", pack.dispute_id)
      .single();
    if (isStaleCycle(pack.response_cycle as number | null, disputeRow?.response_cycle as number | null)) {
      return NextResponse.json(
        {
          error: "STALE_RESPONSE_CYCLE",
          code: "STALE_RESPONSE_CYCLE",
          message: "This pack was built for an earlier round of this dispute. A new pack is needed for the current round.",
        },
        { status: 409 }
      );
    }
    if (
      disputeRow &&
      (await bankClaimBlocksFiling(sb, pack.dispute_id as string, bankClaimInputFromRow(disputeRow as Record<string, unknown>)))
    ) {
      return NextResponse.json(
        {
          error: "BANK_CLAIM_REQUIRED",
          code: "BANK_CLAIM_REQUIRED",
          message: "Add the bank's claim from Shopify Admin before this response can be approved.",
        },
        { status: 409 }
      );
    }
  }

  /* ── PR-C1 candidate preflight, BEFORE any side effect ──
   *
   * Ordering matters: this must precede the `approved_for_save_at` stamp and
   * the enqueue, so a blocked attempt leaves no approval trace and no queued
   * job. Judges the latest candidate, because this route enqueues against the
   * pack and the worker selects the latest version.
   *
   * `requireFileable` closes a second hole found in review: the route checked
   * only that the candidate was content-SAFE, so a safe `draft` — or a `final`
   * with no PDF, or one whose validation failed — was approved and enqueued,
   * and the worker then refused it (`saveToShopifyJob` §3 hard-requires
   * `status='final'` + `pdf_path`). The merchant saw an approval that could
   * never complete. Finalizing through this legacy pack route is deliberately
   * NOT offered: approval happens on the defence-package finalize endpoint,
   * which is the path that performs the safety-gated promotion. */
  const preflight = await preflightLatestCandidate(sb, pack.dispute_id as string, {
    requireFileable: true,
  });
  if (preflightBlocks(preflight)) {
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: userId ? "merchant" : "system",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId: preflightCandidate(preflight)?.id ?? null,
        version: preflightCandidate(preflight)?.version ?? null,
        outcome: preflight.kind,
        reasons: preflightReasons(preflight),
        trigger: "portal_approve",
      },
    });
    const refusal = preflightHttpRefusal(preflight);
    return NextResponse.json(
      {
        error: refusal.code,
        code: refusal.code,
        reasons: refusal.reasons,
        message: refusal.message,
      },
      { status: refusal.status },
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

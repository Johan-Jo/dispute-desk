import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  preflightBlocks,
  preflightLatestCandidate,
  preflightReasons,
  preflightSummary,
} from "@/lib/defence/packageSafety";
import { parseJsonBody } from "@/lib/http/parseJsonBody";

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
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();

  const { data: pack, error } = await sb
    .from("evidence_packs")
    .select("id, shop_id, dispute_id, status, completeness_score, submission_readiness")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();

  if (error || !pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  // Hard status gate. Only a successfully built pack (status === "ready")
  // can be submitted. Packs in "failed", "queued", "building", "saving",
  // "saved_to_shopify*", or "save_failed" must not be submittable.
  // Evidence-derived fields (submission_readiness, completeness_score)
  // are only meaningful when status === "ready".
  if (pack.status !== "ready") {
    return NextResponse.json(
      {
        error: "PACK_NOT_READY",
        status: pack.status,
        message: "Pack is not in a submittable state. Only successfully built packs can be submitted.",
      },
      { status: 409 }
    );
  }

  // Server-side gate — use v2 readiness when available, fall back to legacy
  const score = pack.completeness_score ?? 0;
  const readiness = (pack.submission_readiness as string) ?? null;

  if (readiness === "blocked") {
    return NextResponse.json(
      { error: "PACK_BLOCKED", message: "Submission is blocked — required evidence missing." },
      { status: 422 }
    );
  }

  if (score === 0) {
    return NextResponse.json(
      { error: "PACK_INCOMPLETE", message: "Pack has no evidence collected. Add evidence before saving to Shopify." },
      { status: 422 }
    );
  }

  const parsed = await parseJsonBody<{ confirmLowCompleteness?: boolean; confirmWarnings?: boolean }>(req);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  // V2: warn on ready_with_warnings; legacy: warn on score < 80
  const hasWarnings = readiness === "ready_with_warnings";
  const hasLowScore = score < 80;
  const confirmed = body.confirmWarnings || body.confirmLowCompleteness;

  if ((hasWarnings || hasLowScore) && !confirmed) {
    return NextResponse.json(
      { error: "PACK_HAS_WARNINGS", score, readiness, message: "High-impact evidence is missing. Send confirmWarnings: true to proceed." },
      { status: 422 }
    );
  }

  // PR-C1 — candidate-safety preflight on the LATEST defence package, before
  // any enqueue or status change. Refused here as well as in the job so a
  // merchant gets an immediate, explained 422 rather than a queued job that
  // fails minutes later. Regenerating produces a new version judged on its own
  // merits.
  const preflight = await preflightLatestCandidate(sb, pack.dispute_id as string);
  if (preflightBlocks(preflight)) {
    await logAuditEvent({
      shopId: pack.shop_id,
      disputeId: pack.dispute_id,
      packId,
      actorType: "merchant",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId: preflight.candidate?.id ?? null,
        version: preflight.candidate?.version ?? null,
        reasons: preflightReasons(preflight),
        retiredKeys: preflight.verdict.retiredKeys,
        trigger: "manual_save",
      },
    });
    return NextResponse.json(
      {
        error: "PACKAGE_REVIEW_REQUIRED",
        code: "PACKAGE_REVIEW_REQUIRED",
        reasons: preflightReasons(preflight),
        message: preflightSummary(preflight),
      },
      { status: 422 },
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

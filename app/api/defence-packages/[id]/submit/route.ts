/**
 * POST /api/defence-packages/:id/submit
 *
 * Enqueue the standard `save_to_shopify` job pinned to this package.
 * Submission only allowed when status=final. `saveToShopifyJob` reads the
 * package and swaps the uncategorizedFile buffer to the defence-package
 * PDF (per Commit 10 activation).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  preflightBlocks,
  preflightNamedCandidate,
  preflightReasons,
  preflightSummary,
} from "@/lib/defence/packageSafety";

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
  const { data: pkg } = await sb
    .from("defence_packages")
    .select("id, status, source_pack_id, shop_id, dispute_id")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();
  if (!pkg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pkg.status !== "final") {
    return NextResponse.json(
      {
        error: `Cannot submit a package in status=${pkg.status}. Only final packages may be submitted.`,
        code: "INVALID_STATUS",
      },
      { status: 409 },
    );
  }

  /* ── PR-C1 candidate-safety preflight, BEFORE any enqueue ──
   *
   * This route is what the embedded Review & Submit card calls. Enqueueing
   * first and blocking in the worker showed the merchant a submitted state for
   * a package that was never going to be filed, so the check has to happen
   * here.
   *
   * It judges the EXACT package named in the URL and, separately, proves that
   * package is still the newest version — because the job is keyed to the
   * source pack and the worker re-selects the latest row. Without the
   * currency check this endpoint would only look pinned. */
  const preflight = await preflightNamedCandidate(sb, {
    packageId: pkg.id as string,
    disputeId: pkg.dispute_id as string,
  });
  if (preflightBlocks(preflight)) {
    await logAuditEvent({
      shopId: pkg.shop_id as string,
      disputeId: pkg.dispute_id as string,
      packId: pkg.source_pack_id as string,
      actorType: "merchant",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId: pkg.id,
        version: preflight.candidate?.version ?? null,
        reasons: preflightReasons(preflight),
        isCurrent: preflight.isCurrent,
        trigger: "embedded_submit",
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

  // Enqueue the standard save_to_shopify job pinned to the source pack.
  // saveToShopifyJob (post-Commit 10) reads the latest final defence_packages
  // row for the dispute and swaps the uncategorizedFile buffer.
  const { error: jobErr } = await sb.from("jobs").insert({
    shop_id: pkg.shop_id,
    job_type: "save_to_shopify",
    entity_id: pkg.source_pack_id,
  });
  if (jobErr) {
    return NextResponse.json(
      { error: `Enqueue failed: ${jobErr.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

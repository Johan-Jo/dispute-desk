/**
 * POST /api/defence-packages/:id/submit
 *
 * Enqueue the standard `save_to_shopify` job for this package's source pack.
 *
 * ACCEPTED LIMITATION — the job is NOT pinned to the package named in the URL.
 * It is keyed to `source_pack_id`, and `saveToShopifyJob` independently
 * re-selects the LATEST defence package for the dispute when it runs. This
 * endpoint proves, inside the enqueue transaction, that the named package is
 * the latest at the moment the job is created; if a newer version lands
 * afterwards, the worker files that one instead. That is deliberate — the
 * newest candidate is the right thing to file — and the worker keeps its own
 * independent safety gate, which re-runs the PR-C1 checks on whatever it
 * selects. Repinning the job payload to a package id is a separate change and
 * is not required for PR-C1 safety. Earlier comments here claimed the job was
 * "pinned to this package"; it never was.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import {
  preflightBlocks,
  preflightCandidate,
  preflightHttpRefusal,
  preflightNamedCandidate,
  preflightReasons,
  preflightRevision,
} from "@/lib/defence/packageSafety";
import { parseEnqueueRpcResult } from "@/lib/defence/finalizeRpc";

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
   * currency check this endpoint would only look pinned.
   *
   * `requireFileable` closes the last gap: the status check above proves
   * `final`, but said nothing about `validation_status` or `pdf_path`. A
   * content-safe `final` package whose validation failed, or which has no
   * rendered PDF, could still be enqueued here — and `saveToShopifyJob` §3
   * would then refuse it, after the card had already shown a submitted state.
   * Same central contract the two pack-level routes use. */
  const preflight = await preflightNamedCandidate(
    sb,
    { packageId: pkg.id as string, disputeId: pkg.dispute_id as string },
    { requireFileable: true },
  );
  if (preflightBlocks(preflight)) {
    await logAuditEvent({
      shopId: pkg.shop_id as string,
      disputeId: pkg.dispute_id as string,
      packId: pkg.source_pack_id as string,
      actorType: "merchant",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId: pkg.id,
        version: preflightCandidate(preflight)?.version ?? null,
        outcome: preflight.kind,
        reasons: preflightReasons(preflight),
        trigger: "embedded_submit",
      },
    });
    // A database failure is not something the merchant fixes by regenerating:
    // 503 + retry, never 422 + "regenerate".
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

  // ── Enqueue, in the same transaction as the recheck ──────────────────
  //
  // The preflight above proves currency and fileability at read time; between
  // that read and a plain `jobs.insert` a newer version can land, or the
  // package can be superseded or invalidated. `enqueue_defence_package_save`
  // re-checks the exact inspected revision, currency, `status='final'`,
  // `validation_status='ok'` and a TRIMMED non-empty PDF path under a
  // `FOR UPDATE` lock on the dispute, and inserts the job in the same
  // transaction — so the job cannot outlive the state that justified it.
  //
  // `saveToShopifyJob` keeps its own independent safety gate; this is the
  // near-side of a defence in depth, not a replacement for it.
  const contentRevision = preflightRevision(preflight);
  if (!contentRevision) {
    return NextResponse.json(
      {
        error: "PACKAGE_NOT_FILEABLE",
        code: "PACKAGE_NOT_FILEABLE",
        reasons: ["candidate_revision_unavailable"],
        message: "This defence package could not be verified. Refresh and try again.",
      },
      { status: 409 },
    );
  }

  const { data: rpcData, error: rpcErr } = await sb.rpc("enqueue_defence_package_save", {
    p_package_id: pkg.id as string,
    p_expected_revision: contentRevision,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: `Enqueue failed: ${rpcErr.message}` },
      { status: 500 },
    );
  }

  // STRICT. An unrecognised reply is an UNKNOWN, not a success. The previous
  // revision returned 200 for `null`, `{}`, an array or a misspelled outcome.
  const result = parseEnqueueRpcResult(rpcData);

  if (result.kind === "malformed") {
    console.error("[defence submit] malformed RPC reply", result.detail, rpcData);
    return NextResponse.json(
      {
        error: "PACKAGE_CHECK_UNAVAILABLE",
        code: "PACKAGE_CHECK_UNAVAILABLE",
        message: "We could not queue this save just now. Please try again in a few minutes.",
      },
      { status: 503 },
    );
  }

  if (result.kind === "conflict") {
    return NextResponse.json(
      {
        error: "PACKAGE_NOT_FILEABLE",
        code: "PACKAGE_NOT_FILEABLE",
        reasons: [result.reason],
        message:
          "This defence package changed while you were reviewing it. Refresh and review the latest version.",
      },
      { status: 409 },
    );
  }

  // `enqueued` and `already_done` are both success: an in-flight save for this
  // pack already covers the request, and a second job would just race it.
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/defence-packages/:id/finalize
 *
 * Promote a draft → final. If a prior `final` row exists for the same
 * dispute, flip its status to `superseded` and set its `superseded_by_id`
 * to this row's id. `submitted` rows are NEVER touched — they remain the
 * historical record of what was sent to the bank.
 *
 * The defence_packages immutability trigger validates that the new
 * superseded_by_id target is in status=final before allowing the write.
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
import { parseFinalizeRpcResult } from "@/lib/defence/finalizeRpc";

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
  const { data: pkg, error } = await sb
    .from("defence_packages")
    .select("id, dispute_id, shop_id, source_pack_id, version, status, validation_status, pdf_path")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();
  if (error || !pkg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // An already-`final` package is handled below as an idempotent success when
  // it is the exact, current, unchanged candidate — a merchant double-click or
  // a retried request must not read as an error. Every OTHER non-draft status
  // is still a hard refusal.
  if (pkg.status !== "draft" && pkg.status !== "final") {
    return NextResponse.json(
      { error: `Cannot finalize a package in status=${pkg.status}` },
      { status: 409 },
    );
  }
  if (pkg.validation_status !== "ok") {
    return NextResponse.json(
      { error: "Cannot finalize — validation has not passed for this draft." },
      { status: 409 },
    );
  }
  if (!pkg.pdf_path) {
    return NextResponse.json(
      { error: "Cannot finalize — no PDF has been rendered yet." },
      { status: 409 },
    );
  }

  /* ── PR-C1 candidate-safety preflight, BEFORE any status mutation ──
   *
   * Finalizing is a real authorization step, not cosmetic: it promotes the
   * draft to `final` AND supersedes the prior final, so an unsafe draft that
   * reaches this route retires the last good package and leaves the dispute
   * with a newest candidate the worker will refuse to file.
   *
   * Suppressing the Finalize button is not an authorization boundary — a stale
   * browser tab, a direct request, a race with a regeneration, or a future UI
   * all reach this handler. The check has to live here.
   *
   * The currency check matters for the same reason it does on submit: this
   * route is named-package, but downstream selection is latest-version. */
  const preflight = await preflightNamedCandidate(sb, {
    packageId: pkg.id as string,
    disputeId: pkg.dispute_id as string,
  });
  if (preflightBlocks(preflight)) {
    // A safety-block audit, deliberately NOT `defence_package_finalized`.
    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "merchant",
      eventType: "defence_package_blocked_unsafe_claim",
      eventPayload: {
        packageId: pkg.id,
        version: preflightCandidate(preflight)?.version ?? pkg.version,
        outcome: preflight.kind,
        reasons: preflightReasons(preflight),
        trigger: "finalize",
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

  // ── One transaction ──────────────────────────────────────────────────
  //
  // Promotion and supersession happen inside `finalize_defence_package`, under
  // a `FOR UPDATE` lock on the parent dispute. A pre-read plus a later guarded
  // update is NOT atomic however many predicates the update repeats:
  //
  //   * a newer version inserted after the preflight leaves this row a draft,
  //     so a field-guarded update promotes a candidate that is no longer the
  //     latest;
  //   * the facts / narrative / PDF this route judged can be rewritten before
  //     the write lands;
  //   * the prior final can become `submitted` between "find the prior final"
  //     and "mark it superseded", and an `.eq("id", …)` update would overwrite
  //     a row this route promises never to touch.
  //
  // `content_revision` is the database-enforced revision of exactly the fields
  // the safety preflight inspected. The transaction refuses if it moved.
  const contentRevision = preflightRevision(preflight);
  if (!contentRevision) {
    return NextResponse.json(
      {
        error: "PACKAGE_LIFECYCLE_CONFLICT",
        code: "PACKAGE_LIFECYCLE_CONFLICT",
        message:
          "This defence package could not be verified for approval. Refresh and try again.",
      },
      { status: 409 },
    );
  }

  // Idempotent success for an exact, current, unchanged already-final
  // candidate. It deliberately does NOT enqueue: this route never has, and
  // reaching the save from here would turn a repeated click into a second
  // filing.
  if (pkg.status === "final") {
    return NextResponse.json({
      ok: true,
      packageId: id,
      version: pkg.version,
      idempotent: true,
    });
  }

  const { data: rpcData, error: rpcErr } = await sb.rpc("finalize_defence_package", {
    p_package_id: id,
    p_expected_revision: contentRevision,
    p_expected_version: pkg.version,
    p_enqueue_save: false,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: `Finalize failed: ${rpcErr.message}` },
      { status: 500 },
    );
  }

  // STRICT. An unrecognised reply is an UNKNOWN, not a success: it gets the
  // same treatment as a transport failure. The previous revision returned 200
  // for `null`, `{}`, an array or a misspelled outcome.
  const result = parseFinalizeRpcResult(rpcData, { expectEnqueue: false });

  if (result.kind === "malformed") {
    console.error("[defence finalize] malformed RPC reply", result.detail, rpcData);
    return NextResponse.json(
      {
        error: "PACKAGE_CHECK_UNAVAILABLE",
        code: "PACKAGE_CHECK_UNAVAILABLE",
        message: "We could not complete the approval just now. Please try again in a few minutes.",
      },
      { status: 503 },
    );
  }

  // Nothing was written: the transaction refused, or rolled back whole.
  if (result.kind === "conflict") {
    return NextResponse.json(
      {
        error: "PACKAGE_LIFECYCLE_CONFLICT",
        code: "PACKAGE_LIFECYCLE_CONFLICT",
        reason: result.reason,
        message:
          "This defence package changed while you were reviewing it. Refresh and review the latest version.",
      },
      { status: 409 },
    );
  }

  // `already_done` is a successful idempotent replay — the same revision was
  // already promoted. Do not write a second finalization audit for it.
  if (result.kind === "promoted") {
    if (result.supersededId) {
      await logAuditEvent({
        shopId: pkg.shop_id,
        disputeId: pkg.dispute_id,
        packId: pkg.source_pack_id,
        actorType: "merchant",
        eventType: "defence_package_superseded",
        eventPayload: {
          supersededId: result.supersededId,
          supersededVersion: result.supersededVersion,
          replacedById: id,
          replacedByVersion: pkg.version,
        },
      });
    }

    await logAuditEvent({
      shopId: pkg.shop_id,
      disputeId: pkg.dispute_id,
      packId: pkg.source_pack_id,
      actorType: "merchant",
      eventType: "defence_package_finalized",
      eventPayload: {
        packageId: id,
        version: pkg.version,
        pdfPath: pkg.pdf_path,
      },
    });
  }

  return NextResponse.json({ ok: true, packageId: id, version: pkg.version });
}

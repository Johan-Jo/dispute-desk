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
  if (pkg.status !== "draft") {
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

  // Step 1: this draft → final.
  const { error: finalErr } = await sb
    .from("defence_packages")
    .update({ status: "final", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (finalErr) {
    return NextResponse.json(
      { error: `Finalize failed: ${finalErr.message}` },
      { status: 500 },
    );
  }

  // Step 2: supersede any prior final.
  const { data: priorFinal } = await sb
    .from("defence_packages")
    .select("id, version")
    .eq("dispute_id", pkg.dispute_id)
    .eq("status", "final")
    .neq("id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorFinal) {
    const { error: supErr } = await sb
      .from("defence_packages")
      .update({
        status: "superseded",
        superseded_by_id: id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", priorFinal.id);
    if (supErr) {
      // The new row is already final — log and continue. The trigger only
      // permits superseded_by_id when the target is in status=final, so a
      // failure here means a concurrent mutation; safe to retry later.
      console.error("[defence finalize] superseded update failed", supErr);
    } else {
      await logAuditEvent({
        shopId: pkg.shop_id,
        disputeId: pkg.dispute_id,
        packId: pkg.source_pack_id,
        actorType: "merchant",
        eventType: "defence_package_superseded",
        eventPayload: {
          supersededId: priorFinal.id,
          supersededVersion: priorFinal.version,
          replacedById: id,
          replacedByVersion: pkg.version,
        },
      });
    }
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

  return NextResponse.json({ ok: true, packageId: id, version: pkg.version });
}

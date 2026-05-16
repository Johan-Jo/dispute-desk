/**
 * GET /api/packs/:packId/defence-packages
 *
 * Lists defence packages for a pack and returns the latest. Used by the
 * embedded ReviewSubmitTab to render the CompleteDefencePackageCard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

export async function GET(
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
  const sb = getServiceClient();
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (!pack) return NextResponse.json({ error: "Pack not found" }, { status: 404 });

  const { data } = await sb
    .from("defence_packages")
    .select(
      "id, version, status, package_mode, generated_at, generated_by, pdf_path, evidence_hash, llm_model, prompt_family, prompt_version, reason_code_module, validation_status, validation_errors, failure_code, failure_reason, submitted_at",
    )
    .eq("source_pack_id", packId)
    .eq("shop_id", shopId)
    .order("version", { ascending: false });

  return NextResponse.json({
    latest: data?.[0] ?? null,
    all: data ?? [],
  });
}

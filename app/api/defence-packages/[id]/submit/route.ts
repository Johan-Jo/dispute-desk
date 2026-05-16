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
    .select("id, status, source_pack_id, shop_id")
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

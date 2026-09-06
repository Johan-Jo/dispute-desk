/**
 * POST /api/packs/:packId/defence-package
 *
 * Manually enqueue a Defence Package draft generation for a pack. The
 * auto-build trigger fires from `buildPackJob` after a successful pack
 * build; this endpoint exists for merchant-initiated regeneration or
 * admin retries.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { isDefencePackageBuilderEnabled } from "@/lib/featureFlags";
import { maybeEnqueueDefencePackage } from "@/lib/defence/enqueue";
import { JOB_PRIORITY_INTERACTIVE } from "@/lib/jobs/priorities";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  if (!isDefencePackageBuilderEnabled()) {
    return NextResponse.json(
      { error: "Defence Package builder is not enabled.", code: "FLAG_OFF" },
      { status: 404 },
    );
  }

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
    .select("id, shop_id")
    .eq("id", packId)
    .eq("shop_id", shopId)
    .single();
  if (!pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const result = await maybeEnqueueDefencePackage(packId, {
    priority: JOB_PRIORITY_INTERACTIVE,
  });
  return NextResponse.json(result);
}

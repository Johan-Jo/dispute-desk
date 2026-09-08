/**
 * GET /api/dashboard/message
 *
 * Returns the active admin→merchant message for the current shop, or
 * { message: null }. Drives the dashboard banner.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { getActiveMerchantMessage } from "@/lib/merchantMessages/activeMessage";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }
  const message = await getActiveMerchantMessage(shopId);
  return NextResponse.json({ message });
}

import { NextRequest, NextResponse } from "next/server";
import { evaluateReadiness } from "@/lib/setup/readiness";

/**
 * GET /api/setup/readiness
 * Returns live readiness state for Step 1 (Connection & Readiness).
 * No DB writes — purely derived from session, scopes, webhooks, and store data.
 */
export async function GET(req: NextRequest) {
  const url = "nextUrl" in req && req.nextUrl ? req.nextUrl : new URL(req.url);
  const shopId =
    url.searchParams.get("shop_id") ??
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const result = await evaluateReadiness(shopId);
  return NextResponse.json(result);
}

import { NextRequest, NextResponse } from "next/server";
import { evaluateReadiness } from "@/lib/setup/readiness";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/setup/readiness
 * Returns live readiness state for Step 1 (Connection & Readiness).
 * No DB writes — purely derived from session, scopes, webhooks, and store data.
 */
export async function GET(req: NextRequest) {
  const url = "nextUrl" in req && req.nextUrl ? req.nextUrl : new URL(req.url);
  let shopId =
    url.searchParams.get("shop_id") ??
    req.headers.get("x-shop-id") ??
    req.cookies?.get?.("dd_active_shop")?.value ??
    req.cookies?.get?.("active_shop_id")?.value;

  // Embedded fallback: when the `shopify_shop_id` CHIPS cookie didn't ride along
  // (partitioned-cookie timing inside the Admin iframe), middleware resolves
  // shopId="demo" for an embedded-only install with no portal link — which makes
  // a fully-connected shop report as "not connected". If the request carries the
  // real `?shop=<domain>`, resolve the actual shop row by domain instead.
  const shopDomain = url.searchParams.get("shop");
  if ((!shopId || shopId === "demo") && shopDomain) {
    const { data } = await getServiceClient()
      .from("shops")
      .select("id")
      .eq("shop_domain", shopDomain)
      .maybeSingle();
    if (data?.id) shopId = data.id;
  }

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const result = await evaluateReadiness(shopId);
  return NextResponse.json(result);
}

import { NextRequest, NextResponse } from "next/server";
import { extractShopIdFromBody } from "@/lib/middleware/extractShopId";
import { ingestShopifyPolicies } from "@/lib/policies/ingestShopifyPolicies";

/**
 * POST /api/policies/refresh
 *
 * Body: { shop_id }. Re-reads the merchant's PUBLISHED Shopify store
 * policies (Shop.shopPolicies) and upserts them as `shopify_published`
 * snapshots. Powers the "Refresh from store" action after a merchant
 * publishes a policy — so the freshly-published version becomes citable
 * bank evidence. Idempotent (dedup on content hash).
 */
export async function POST(req: NextRequest) {
  let body: { shop_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional — shop_id may come from query/header instead
  }

  const shopId = extractShopIdFromBody(req, body);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const result = await ingestShopifyPolicies(shopId);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

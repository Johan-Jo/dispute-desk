import { NextRequest, NextResponse } from "next/server";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";

/**
 * GET /api/shop/details?shop_id=<uuid>
 * Returns basic shop info (name, email, phone, address, primaryDomain)
 * fetched from Shopify Admin GraphQL via the stored offline session.
 */
export async function GET(req: NextRequest) {
  const shopId =
    req.nextUrl.searchParams.get("shop_id") ??
    req.cookies.get("shopify_shop_id")?.value ??
    null;

  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  try {
    const details = await fetchShopDetails(shopId);
    if (!details) {
      return NextResponse.json({ error: "Shop not found or no session" }, { status: 404 });
    }
    return NextResponse.json(details);
  } catch (err) {
    console.error("[shop/details] failed", {
      shopId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Unable to fetch shop details right now" },
      { status: 503 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getPortalUser } from "@/lib/supabase/portal";
import { getLinkedShops, setActiveShopId } from "@/lib/portal/activeShop";

/**
 * GET /api/portal/switch-shop?shop_id=xxx
 *
 * Sets the active-shop cookie and redirects to dashboard.
 * Cookie mutation must run in a Route Handler in Next.js 15, not in a Server Component.
 */
export async function GET(req: NextRequest) {
  const user = await getPortalUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/sign-in", req.url));
  }

  const shopId = req.nextUrl.searchParams.get("shop_id");
  if (!shopId) {
    return NextResponse.redirect(new URL("/portal/select-store", req.url));
  }

  const shops = await getLinkedShops(user.id);
  const hasAccess = shops.some((s) => s.shop_id === shopId);
  if (!hasAccess) {
    return NextResponse.redirect(new URL("/portal/select-store", req.url));
  }

  await setActiveShopId(shopId);
  return NextResponse.redirect(new URL("/portal/dashboard", req.url));
}

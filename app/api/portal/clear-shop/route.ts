import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "active_shop_id";
const DD_COOKIE_NAME = "dd_active_shop";

/**
 * GET /api/portal/clear-shop
 *
 * Clears the active-shop cookies and redirects to connect-shopify
 * so the user can do a fresh reconnect.
 */
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(DD_COOKIE_NAME);
  const origin = req.nextUrl.origin;
  return NextResponse.redirect(`${origin}/portal/connect-shopify`, 303);
}

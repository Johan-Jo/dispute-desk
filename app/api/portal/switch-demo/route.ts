import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "active_shop_id";
const DD_COOKIE_NAME = "dd_active_shop";

/**
 * GET /api/portal/switch-demo
 *
 * Clears the active-shop cookies (demo mode) and redirects to dashboard.
 * Cookie mutation must run in a Route Handler in Next.js 15, not in a Server Component.
 */
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(DD_COOKIE_NAME);
  return NextResponse.redirect(new URL("/portal/dashboard", req.url));
}

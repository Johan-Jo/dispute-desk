import { NextRequest, NextResponse } from "next/server";

/**
 * Session validation middleware.
 *
 * Protects /api/* routes (except auth, webhooks, health, jobs/worker)
 * by verifying a Shopify session cookie is present.
 *
 * Actual token validation happens in the route handlers via loadSession().
 * This middleware is a fast-path guard to reject clearly unauthenticated requests.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes — skip auth check
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname === "/api/health" ||
    pathname === "/api/jobs/worker"
  ) {
    return NextResponse.next();
  }

  // Protected API routes — require shop cookie
  if (pathname.startsWith("/api/")) {
    const shopDomain = req.cookies.get("shopify_shop")?.value;
    const shopId = req.cookies.get("shopify_shop_id")?.value;

    if (!shopDomain || !shopId) {
      return NextResponse.json(
        {
          error: "Unauthorized. Install or re-open the app from Shopify Admin.",
          code: "SESSION_REQUIRED",
        },
        { status: 401 }
      );
    }

    // Pass shop context via headers for route handlers
    const res = NextResponse.next();
    res.headers.set("x-shop-domain", shopDomain);
    res.headers.set("x-shop-id", shopId);
    return res;
  }

  // App pages — if no shop cookie, redirect to Shopify OAuth
  const shopDomain = req.cookies.get("shopify_shop")?.value;
  if (!shopDomain && pathname !== "/" && !pathname.startsWith("/_next")) {
    // For embedded apps, Shopify sends ?shop= on first load
    const shopParam = req.nextUrl.searchParams.get("shop");
    if (shopParam) {
      return NextResponse.redirect(
        new URL(`/api/auth/shopify?shop=${shopParam}`, req.url)
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

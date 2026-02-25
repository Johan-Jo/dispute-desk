import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Multi-surface middleware.
 *
 * - (marketing) + (auth): public, no auth required.
 * - (portal): requires Supabase Auth session.
 * - (embedded): requires Shopify session cookie.
 * - /api/*: mixed auth (public for auth/webhooks/health, Shopify session for rest).
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Public routes: marketing, auth, static assets ---
  if (
    pathname === "/" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // --- API routes ---
  if (pathname.startsWith("/api/")) {
    if (
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/webhooks") ||
      pathname === "/api/health" ||
      pathname === "/api/jobs/worker" ||
      pathname.startsWith("/api/cron/")
    ) {
      return NextResponse.next();
    }

    const shopDomain = req.cookies.get("shopify_shop")?.value;
    const shopId = req.cookies.get("shopify_shop_id")?.value;

    if (!shopDomain || !shopId) {
      return NextResponse.json(
        {
          error:
            "Unauthorized. Install or re-open the app from Shopify Admin.",
          code: "SESSION_REQUIRED",
        },
        { status: 401 }
      );
    }

    const res = NextResponse.next();
    res.headers.set("x-shop-domain", shopDomain);
    res.headers.set("x-shop-id", shopId);
    return res;
  }

  // --- Portal routes: require Supabase Auth ---
  if (pathname.startsWith("/portal")) {
    const res = NextResponse.next();

    const supabase = createServerClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              req.cookies.set(name, value);
              res.cookies.set(name, value, options);
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      const signInUrl = new URL("/auth/sign-in", req.url);
      signInUrl.searchParams.set("continue", pathname);
      return NextResponse.redirect(signInUrl);
    }

    return res;
  }

  // --- Embedded app routes (/app/*): require Shopify session ---
  if (pathname.startsWith("/app")) {
    const shopDomain = req.cookies.get("shopify_shop")?.value;
    if (!shopDomain) {
      const shopParam = req.nextUrl.searchParams.get("shop");
      if (shopParam) {
        return NextResponse.redirect(
          new URL(`/api/auth/shopify?shop=${shopParam}`, req.url)
        );
      }
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/portal/:path*",
    "/app/:path*",
    "/auth/:path*",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

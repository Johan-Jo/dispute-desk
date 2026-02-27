import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { checkRateLimit } from "@/lib/middleware/rateLimit";

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
    // Webhook rate limit: 1000/min global
    if (pathname.startsWith("/api/webhooks")) {
      const rl = checkRateLimit("webhooks:global", 1000);
      if (!rl.allowed) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
      return NextResponse.next();
    }

    if (
      pathname.startsWith("/api/auth") ||
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

    // Per-shop rate limit: 100/min
    const rl = checkRateLimit(`shop:${shopId}`, 100);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
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
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // --- Admin routes: require admin session cookie ---
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();
    const adminCookie = req.cookies.get("dd_admin_session")?.value;
    if (adminCookie !== "authenticated") {
      return NextResponse.redirect(new URL("/admin/login", req.url));
    }
    return NextResponse.next();
  }

  // --- Embedded app routes (/app/*): require Shopify session ---
  if (pathname.startsWith("/app")) {
    if (pathname === "/app/session-required") {
      return NextResponse.next();
    }

    const shopDomain = req.cookies.get("shopify_shop")?.value;
    if (!shopDomain) {
      const shopParam = req.nextUrl.searchParams.get("shop");
      if (shopParam) {
        return NextResponse.redirect(
          new URL(`/api/auth/shopify?shop=${shopParam}`, req.url)
        );
      }

      const sessionUrl = new URL("/app/session-required", req.url);
      sessionUrl.searchParams.set("returnTo", pathname + req.nextUrl.search);
      return NextResponse.redirect(sessionUrl);
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
    "/admin/:path*",
    "/auth/:path*",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

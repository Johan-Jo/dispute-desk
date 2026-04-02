import { NextRequest, NextResponse } from "next/server";
import createNextIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing } from "@/i18n/routing";
import {
  DEFAULT_PATH_LOCALE,
  PATH_LOCALE_PREFIX_PATTERN,
  messagesLocaleToPath,
} from "@/lib/i18n/pathLocales";
import { isLocale, type Locale } from "@/lib/i18n/locales";
import { checkRateLimit } from "@/lib/middleware/rateLimit";
import { isPortalApiPath } from "@/lib/middleware/portalApiPrefixes";
import {
  enPrefixedHubPathRegex,
  hubPublicPathRegex,
  isMarketingHubPath,
} from "@/lib/middleware/marketingHubPaths";

const intlMiddleware = createNextIntlMiddleware(routing);
const localePathRegex = new RegExp(
  `^\\/(${PATH_LOCALE_PREFIX_PATTERN})(\\/.*)?$`
);

/** Forwarded to root layout: only `/app/*` should load `app-bridge.js` (avoids App Bridge on marketing). */
const APP_BRIDGE_HEADER = "x-dd-load-app-bridge";

function requestWithAppBridge(req: NextRequest, load: "0" | "1"): NextRequest {
  const h = new Headers(req.headers);
  h.set(APP_BRIDGE_HEADER, load);
  return new NextRequest(req, { headers: h });
}

function nextWithAppBridge(req: NextRequest, load: "0" | "1"): NextResponse {
  const h = new Headers(req.headers);
  h.set(APP_BRIDGE_HEADER, load);
  return NextResponse.next({ request: { headers: h } });
}

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

  // Next.js chunks, HMR, and build internals must bypass all logic below. If any matcher
  // edge-case runs middleware for these paths, auth/i18n can break chunk loading (ChunkLoadError).
  if (pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  // --- Embedded app entry: Shopify loads application_url (/) in iframe; redirect to /app with same query ---
  if (pathname === "/" && req.nextUrl.searchParams.has("shop")) {
    const appUrl = new URL("/app", req.url);
    req.nextUrl.searchParams.forEach((value, key) => appUrl.searchParams.set(key, value));
    return NextResponse.redirect(appUrl);
  }

  // --- Legacy BCP-47 marketing URLs → two-letter paths ---
  const legacyMatch = pathname.match(
    /^\/(en-US|de-DE|fr-FR|es-ES|pt-BR|sv-SE)(\/?.*)?$/
  );
  if (legacyMatch) {
    const messagesLocale = legacyMatch[1] as Locale;
    if (isLocale(messagesLocale)) {
      const seg = messagesLocaleToPath(messagesLocale);
      const rest = (legacyMatch[2] ?? "").replace(/^\//, "");
      const base = seg === DEFAULT_PATH_LOCALE ? "" : `/${seg}`;
      const targetPath = rest ? `${base}/${rest}` : base || "/";
      return NextResponse.redirect(new URL(targetPath + req.nextUrl.search, req.url));
    }
  }

  // --- Marketing hub: do not render in Shopify Admin embedded iframe (App Bridge sends ?host=...) ---
  if (isMarketingHubPath(pathname) && req.nextUrl.searchParams.has("host")) {
    const target = new URL("/app/help", req.url);
    req.nextUrl.searchParams.forEach((value, key) => {
      target.searchParams.set(key, value);
    });
    return NextResponse.redirect(target);
  }

  // --- Marketing + Resources Hub: `/`, `/privacy`, hub paths, + /de, /es, … + /en/resources/… → next-intl ---
  if (
    pathname === "/" ||
    pathname === "/privacy" ||
    localePathRegex.test(pathname) ||
    hubPublicPathRegex.test(pathname) ||
    enPrefixedHubPathRegex.test(pathname)
  ) {
    return intlMiddleware(requestWithAppBridge(req, "0"));
  }

  // --- Public routes: auth, static assets ---
  if (
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return nextWithAppBridge(req, "0");
  }

  // --- API routes ---
  if (pathname.startsWith("/api/")) {
    // Webhook rate limit: 1000/min global
    if (pathname.startsWith("/api/webhooks")) {
      const rl = checkRateLimit("webhooks:global", 1000);
      if (!rl.allowed) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
      }
      return nextWithAppBridge(req, "0");
    }

    if (
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/admin/") ||
      pathname === "/api/health" ||
      pathname === "/api/indexnow" ||
      pathname === "/api/jobs/worker" ||
      pathname.startsWith("/api/cron/") ||
      pathname === "/api/portal/clear-shop" ||
      (process.env.DD_DEBUG_AGENT_LOG === "1" && pathname === "/api/debug/agent-log")
    ) {
      return nextWithAppBridge(req, "0");
    }

    let shopDomain = req.cookies.get("shopify_shop")?.value;
    let shopId = req.cookies.get("shopify_shop_id")?.value;

    // Portal fallback: these APIs can use Supabase Auth + active_shop (see lib/middleware/portalApiPrefixes.ts)
    const isPortalApi = isPortalApiPath(pathname);

    if ((!shopDomain || !shopId) && isPortalApi) {
      const activeShopId =
        req.cookies.get("dd_active_shop")?.value ??
        req.cookies.get("active_shop_id")?.value;
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => req.cookies.getAll(),
            setAll: () => {},
          },
        }
      );
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        if (activeShopId) {
          const { getServiceClient } = await import("@/lib/supabase/server");
          const db = getServiceClient();
          const { data: link } = await db
            .from("portal_user_shops")
            .select("id")
            .eq("user_id", user.id)
            .eq("shop_id", activeShopId)
            .single();

          if (link) {
            shopId = activeShopId;
            shopDomain = "portal"; // placeholder
          }
        }
        // Test shop (demo) mode: no active shop or invalid — use demo so wizard works
        if (!shopId) {
          shopId = "demo";
          shopDomain = "demo.myshopify.com";
        }
      }
    }

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

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-shop-domain", shopDomain);
    requestHeaders.set("x-shop-id", shopId);
    requestHeaders.set(APP_BRIDGE_HEADER, "0");
    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // --- Portal routes: require Supabase Auth ---
  if (pathname.startsWith("/portal")) {
    const res = nextWithAppBridge(req, "0");

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

  // --- Admin routes: Supabase session + internal_admin_grants (same creds as portal) ---
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return nextWithAppBridge(req, "0");

    const res = nextWithAppBridge(req, "0");
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
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
      signInUrl.searchParams.set("continue", pathname + req.nextUrl.search);
      return NextResponse.redirect(signInUrl);
    }

    const { getServiceClient } = await import("@/lib/supabase/server");
    const db = getServiceClient();
    const { data: grant } = await db
      .from("internal_admin_grants")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!grant) {
      return NextResponse.redirect(new URL("/admin/login?reason=no_access", req.url));
    }

    await db.rpc("dd_admin_touch_last_login", { p_user_id: user.id });

    return res;
  }

  // --- Embedded app routes (/app/*): require Shopify session ---
  if (pathname.startsWith("/app")) {
    const hostParam = req.nextUrl.searchParams.get("host") ?? "";
    const localeParam = req.nextUrl.searchParams.get("locale")?.trim() ?? "";
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(APP_BRIDGE_HEADER, "1");
    requestHeaders.set("x-shopify-host", hostParam);
    // Forward locale param as header so embedded layout can use it on the first
    // request (cookie is set in the response and isn't available until next request).
    if (localeParam) requestHeaders.set("x-shopify-locale", localeParam);

    if (pathname === "/app/session-required") {
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      if (localeParam) {
        res.cookies.set("dd_locale", localeParam, {
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
          sameSite: "lax",
        });
      }
      return res;
    }

    const shopDomain = req.cookies.get("shopify_shop")?.value;
    if (!shopDomain) {
      const shopParam = req.nextUrl.searchParams.get("shop");
      if (shopParam) {
        const authUrl = new URL("/api/auth/shopify", req.url);
        authUrl.searchParams.set("shop", shopParam);
        if (hostParam) authUrl.searchParams.set("host", hostParam);
        return NextResponse.redirect(authUrl);
      }

      const sessionUrl = new URL("/app/session-required", req.url);
      sessionUrl.searchParams.set("returnTo", pathname + req.nextUrl.search);
      return NextResponse.redirect(sessionUrl);
    }

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    if (localeParam) {
      res.cookies.set("dd_locale", localeParam, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return res;
  }

  return nextWithAppBridge(req, "0");
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

import { NextRequest, NextResponse } from "next/server";
import { ingestCheckoutSession } from "@/lib/liabilityShift/sessions/ingest";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { resolveShopIdFromDomain } from "@/lib/liabilityShift/sessions/resolveShopFromDomain";

export const runtime = "nodejs";

/**
 * POST /api/sessions/ingest
 *
 * Storefront ingest endpoint for LSE-4 session capture. Called by the
 * theme app embed / Web Pixel / Checkout UI extension on order intent.
 *
 * Always returns 200 (fail-open) so the storefront never sees a failure
 * that could break checkout UX. Failures are silent on the server side
 * — diagnostics in logs.
 *
 * CORS: storefront calls come from `*.myshopify.com` or the merchant's
 * custom domain — we allow any origin since the body is non-credentialed
 * and the auth lives in `shop_id` (server-validated).
 *
 * Privacy controls:
 *   - DNT and GPC signals from headers OR body cause the request to be
 *     dropped server-side before any DB write
 *   - Raw IP is hashed at rest; encrypted raw retained for matching only
 *   - 18-month TTL via the nightly expire_checkout_sessions job
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, DNT, Sec-GPC",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // Two ways to identify the shop:
    //   1. shop_id (UUID) — used when the embedded app calls this endpoint
    //   2. shop_domain (foo.myshopify.com) — used by all three storefront
    //      extensions; every Shopify surface exposes this for free at
    //      runtime, so the merchant never has to paste a UUID anywhere.
    let shopId =
      extractShopId(req) ??
      (typeof body.shop_id === "string" ? body.shop_id : null);

    if (!shopId) {
      const shopDomain =
        typeof body.shop_domain === "string" ? body.shop_domain : null;
      if (shopDomain) {
        shopId = await resolveShopIdFromDomain(shopDomain);
      }
    }

    if (!shopId) {
      return jsonOk({ ok: true, dropped: true, reason: "no_shop" });
    }

    // Privacy headers override anything claimed by the client body.
    const dntHeader = req.headers.get("dnt") === "1";
    const gpcHeader = req.headers.get("sec-gpc") === "1";
    const dnt = dntHeader || body.dnt === true;
    const gpc = gpcHeader || body.gpc === true;

    // Derive client IP defensively from X-Forwarded-For if present.
    const xff = req.headers.get("x-forwarded-for") ?? "";
    const ip =
      (typeof body.ip === "string" && body.ip.trim()) ||
      xff.split(",")[0]?.trim() ||
      undefined;

    const result = await ingestCheckoutSession({
      shopId,
      cartToken: String(body.cart_token ?? body.cartToken ?? ""),
      sessionStartedAt:
        typeof body.session_started_at === "string"
          ? body.session_started_at
          : undefined,
      userAgent:
        typeof body.user_agent === "string"
          ? body.user_agent
          : req.headers.get("user-agent") ?? undefined,
      ip,
      ipGeoCountry:
        typeof body.ip_geo_country === "string" ? body.ip_geo_country : undefined,
      ipGeoRegion:
        typeof body.ip_geo_region === "string" ? body.ip_geo_region : undefined,
      customerId:
        typeof body.customer_id === "string" ? body.customer_id : undefined,
      customerAccountAgeDays:
        typeof body.customer_account_age_days === "number"
          ? body.customer_account_age_days
          : undefined,
      customerLoginStateAtCheckout:
        body.customer_login_state_at_checkout as
          | "logged_in"
          | "guest"
          | "unknown"
          | undefined,
      sessionHistory: Array.isArray(body.session_history)
        ? (body.session_history as Array<{ path: string; dwellMs?: number; at?: string }>)
        : undefined,
      timeOnCheckoutPageMs:
        typeof body.time_on_checkout_page_ms === "number"
          ? body.time_on_checkout_page_ms
          : undefined,
      dnt,
      gpc,
    });

    return jsonOk({ ok: true, ...result });
  } catch (err) {
    console.warn(
      "[sessions/ingest] unexpected error:",
      err instanceof Error ? err.message : String(err),
    );
    return jsonOk({ ok: true, dropped: true, reason: "internal_error" });
  }
}

function jsonOk(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { headers: CORS_HEADERS });
}

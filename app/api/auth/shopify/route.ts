import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, generateNonce } from "@/lib/shopify/auth";
import { cookies } from "next/headers";

/**
 * GET /api/auth/shopify?shop=xxx.myshopify.com[&source=portal&return_to=/portal/select-store]
 *
 * Initiates Shopify OAuth. First requests an offline (shop-wide) token.
 * After offline token is stored, redirects back for an online (user-scoped) token.
 *
 * Supports portal-initiated OAuth via source=portal query param.
 */
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter" },
      { status: 400 }
    );
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (!apiKey || !appUrl) {
    console.error(
      "[auth/shopify] Missing env: SHOPIFY_API_KEY=%s SHOPIFY_APP_URL=%s",
      apiKey ? "set" : "missing",
      appUrl ? "set" : "missing"
    );
    return NextResponse.json(
      {
        error: "Server misconfiguration",
        detail:
          "SHOPIFY_API_KEY or SHOPIFY_APP_URL is not set. Set them in .env.local (local) or in your hosting provider's environment (e.g. Vercel).",
      },
      { status: 500 }
    );
  }

  const cookieStore = await cookies();
  const phase = req.nextUrl.searchParams.get("phase") ?? "offline";
  const isOnline = phase === "online";

  const source = req.nextUrl.searchParams.get("source") ?? "embedded";
  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "";

  const nonce = generateNonce();

  // SameSite=None so the cookie is sent when Shopify redirects back to the callback (cross-site or iframe)
  const oauthCookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    maxAge: 600,
    path: "/",
  };

  cookieStore.set("shopify_oauth_state", nonce, oauthCookieOptions);
  cookieStore.set("shopify_oauth_phase", phase, oauthCookieOptions);
  cookieStore.set("shopify_oauth_source", source, oauthCookieOptions);

  if (returnTo) {
    cookieStore.set("shopify_oauth_return_to", returnTo, oauthCookieOptions);
  }

  const authUrl = buildAuthUrl(shop, nonce, isOnline);
  return NextResponse.redirect(authUrl);
}

import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, generateNonce } from "@/lib/shopify/auth";
import { cookies } from "next/headers";

/**
 * GET /api/auth/shopify?shop=xxx.myshopify.com
 *
 * Initiates Shopify OAuth. First requests an offline (shop-wide) token.
 * After offline token is stored, redirects back for an online (user-scoped) token.
 */
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter" },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const phase = req.nextUrl.searchParams.get("phase") ?? "offline";
  const isOnline = phase === "online";

  const nonce = generateNonce();

  cookieStore.set("shopify_oauth_state", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  cookieStore.set("shopify_oauth_phase", phase, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authUrl = buildAuthUrl(shop, nonce, isOnline);
  return NextResponse.redirect(authUrl);
}

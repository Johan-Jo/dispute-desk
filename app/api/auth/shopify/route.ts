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

  const cookieStore = await cookies();
  const phase = req.nextUrl.searchParams.get("phase") ?? "offline";
  const isOnline = phase === "online";

  const source = req.nextUrl.searchParams.get("source") ?? "embedded";
  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "";

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

  // Persist source + return_to through the OAuth flow
  cookieStore.set("shopify_oauth_source", source, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  if (returnTo) {
    cookieStore.set("shopify_oauth_return_to", returnTo, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }

  const authUrl = buildAuthUrl(shop, nonce, isOnline);
  return NextResponse.redirect(authUrl);
}

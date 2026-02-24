import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyHmac, exchangeCodeForToken } from "@/lib/shopify/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession } from "@/lib/shopify/sessionStorage";

const APP_URL = process.env.SHOPIFY_APP_URL!;

/**
 * GET /api/auth/shopify/callback
 *
 * Handles both offline and online OAuth callbacks.
 * - Offline phase: stores shop-wide token, then redirects for online token.
 * - Online phase: stores user-scoped token, then redirects to app.
 */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { shop, code, state } = params;

  if (!shop || !code || !state) {
    return NextResponse.json(
      { error: "Missing required OAuth parameters" },
      { status: 400 }
    );
  }

  // Verify HMAC
  if (!verifyHmac(params)) {
    return NextResponse.json(
      { error: "HMAC verification failed" },
      { status: 403 }
    );
  }

  // Verify state nonce
  const cookieStore = await cookies();
  const savedState = cookieStore.get("shopify_oauth_state")?.value;
  if (!savedState || savedState !== state) {
    return NextResponse.json(
      { error: "State mismatch — possible CSRF" },
      { status: 403 }
    );
  }

  const phase = cookieStore.get("shopify_oauth_phase")?.value ?? "offline";

  // Exchange code for token
  const tokenResult = await exchangeCodeForToken(shop, code);

  // Ensure shop exists in DB
  const db = getServiceClient();
  const { data: existingShop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shop)
    .single();

  let shopInternalId: string;

  if (existingShop) {
    shopInternalId = existingShop.id;
    await db
      .from("shops")
      .update({
        uninstalled_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shopInternalId);
  } else {
    const { data: newShop, error } = await db
      .from("shops")
      .insert({ shop_domain: shop })
      .select("id")
      .single();
    if (error || !newShop) {
      return NextResponse.json(
        { error: `Failed to create shop: ${error?.message}` },
        { status: 500 }
      );
    }
    shopInternalId = newShop.id;
  }

  if (phase === "offline") {
    // Store offline (shop-wide) session
    await storeSession({
      shopInternalId,
      shopDomain: shop,
      sessionType: "offline",
      userId: null,
      accessToken: tokenResult.accessToken,
      scopes: tokenResult.scope,
      expiresAt: null,
    });

    // Clean up cookies and redirect for online token
    cookieStore.delete("shopify_oauth_state");
    cookieStore.delete("shopify_oauth_phase");

    const onlineAuthUrl = `${APP_URL}/api/auth/shopify?shop=${shop}&phase=online`;
    return NextResponse.redirect(onlineAuthUrl);
  }

  // Online phase — store user-scoped session
  const userId = tokenResult.associatedUser?.id?.toString() ?? null;
  const expiresAt = tokenResult.expiresIn
    ? new Date(Date.now() + tokenResult.expiresIn * 1000).toISOString()
    : null;

  await storeSession({
    shopInternalId,
    shopDomain: shop,
    sessionType: "online",
    userId,
    accessToken: tokenResult.accessToken,
    scopes: tokenResult.scope,
    expiresAt,
  });

  // Clean up cookies
  cookieStore.delete("shopify_oauth_state");
  cookieStore.delete("shopify_oauth_phase");

  // Set shop cookie for session middleware
  cookieStore.set("shopify_shop", shop, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  cookieStore.set("shopify_shop_id", shopInternalId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  // Redirect to embedded app
  const embeddedUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
  return NextResponse.redirect(embeddedUrl);
}

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyHmac, exchangeCodeForToken } from "@/lib/shopify/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";

const APP_URL = process.env.SHOPIFY_APP_URL!;

/**
 * GET /api/auth/shopify/callback
 *
 * Handles both offline and online OAuth callbacks.
 * Supports portal-initiated OAuth (source=portal) — links portal user to shop.
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

  // Verify HMAC using only params Shopify sent (exclude our retry param _top)
  const { _top: _retry, ...shopifyParams } = params;
  if (!verifyHmac(shopifyParams)) {
    return NextResponse.json(
      { error: "HMAC verification failed" },
      { status: 403 }
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("shopify_oauth_state")?.value;
  if (!savedState || savedState !== state) {
    // Callback may load in an iframe (Shopify Admin), so the state cookie can be blocked.
    // Retry once in the top-level window so the cookie is sent (first-party).
    const isTopLevelRetry = req.nextUrl.searchParams.get("_top") === "1";
    if (!isTopLevelRetry) {
      const retryUrl = new URL(req.url);
      retryUrl.searchParams.set("_top", "1");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Completing install…</title></head><body><p>Completing install…</p><script>window.top.location.href=${JSON.stringify(retryUrl.toString())};</script></body></html>`;
      return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return NextResponse.json(
      { error: "State mismatch — possible CSRF" },
      { status: 403 }
    );
  }

  const phase = cookieStore.get("shopify_oauth_phase")?.value ?? "offline";
  const source = cookieStore.get("shopify_oauth_source")?.value ?? "embedded";
  const returnTo = cookieStore.get("shopify_oauth_return_to")?.value ?? "";

  const tokenResult = await exchangeCodeForToken(shop, code);

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
    await storeSession({
      shopInternalId,
      shopDomain: shop,
      sessionType: "offline",
      userId: null,
      accessToken: tokenResult.accessToken,
      scopes: tokenResult.scope,
      expiresAt: null,
    });

    // Register dispute webhooks (non-blocking; do not delay redirect)
    registerDisputeWebhooks({
      shopDomain: shop,
      accessToken: tokenResult.accessToken,
    })
      .then((result) => {
        if (!result.ok && result.errors.length) {
          console.warn(
            "[webhooks] Dispute webhook registration:",
            result.errors
          );
        }
      })
      .catch((err) => {
        console.warn(
          "[webhooks] Dispute webhook registration failed:",
          err?.message ?? err
        );
      });

    cookieStore.delete("shopify_oauth_state");
    cookieStore.delete("shopify_oauth_phase");

    if (source === "portal") {
      // Portal flow: skip online phase, link user to shop, redirect to portal
      await linkPortalUserToShop(req, db, shopInternalId);

      cookieStore.delete("shopify_oauth_source");
      cookieStore.delete("shopify_oauth_return_to");

      const destination = returnTo || "/portal/select-store";
      return NextResponse.redirect(new URL(destination, req.url));
    }

    // Embedded flow: proceed to online token phase
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

  // Clean up all OAuth cookies
  cookieStore.delete("shopify_oauth_state");
  cookieStore.delete("shopify_oauth_phase");
  cookieStore.delete("shopify_oauth_source");
  cookieStore.delete("shopify_oauth_return_to");

  // Set shop cookies for embedded session middleware
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

  const embeddedUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
  return NextResponse.redirect(embeddedUrl);
}

/**
 * Link the current portal user (from Supabase Auth cookie) to the shop.
 * Creates a portal_user_shops row if one doesn't already exist.
 * If this is the user's first shop link, sends a welcome email.
 */
async function linkPortalUserToShop(
  req: NextRequest,
  db: ReturnType<typeof getServiceClient>,
  shopId: string
) {
  const { createServerClient } = await import("@supabase/ssr");

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          // Read-only in this context — session cookies are already set
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { count } = await db
    .from("portal_user_shops")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const isFirstShop = (count ?? 0) === 0;

  await db.from("portal_user_shops").upsert(
    {
      user_id: user.id,
      shop_id: shopId,
      role: "admin",
    },
    { onConflict: "user_id,shop_id" }
  );

  if (isFirstShop && user.email) {
    const fullName =
      (user.user_metadata?.full_name as string | undefined)?.trim() || undefined;
    sendWelcomeEmail({
      to: user.email,
      fullName,
      idempotencyKey: `welcome/${user.id}`,
    }).then((result) => {
      if (!result.ok) console.warn("[email] Welcome send failed after OAuth:", result.error);
    });
  }
}

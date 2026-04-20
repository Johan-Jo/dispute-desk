import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyHmac, exchangeCodeForToken, decodeOAuthState } from "@/lib/shopify/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";
import { sendAdminSignupNotification } from "@/lib/email/sendAdminNotification";
import { normalizeLocale } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/locales";

const APP_URL = process.env.SHOPIFY_APP_URL!;

const PORTAL_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 90,
  path: "/",
};

/**
 * GET /api/auth/shopify/callback
 *
 * Handles both offline and online OAuth callbacks.
 * Phase/source/return_to are recovered from the signed state token (not cookies).
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

  if (!verifyHmac(params)) {
    return NextResponse.json(
      { error: "HMAC verification failed" },
      { status: 403 }
    );
  }

  const oauthState = decodeOAuthState(state);
  if (!oauthState) {
    return NextResponse.json(
      { error: "Invalid or tampered state token" },
      { status: 403 }
    );
  }

  const { phase, source, returnTo } = oauthState;

  // Resolve locale for emails: dd_locale cookie → Accept-Language → en-US
  const cookieStore = await cookies();
  const locale: Locale =
    normalizeLocale(cookieStore.get("dd_locale")?.value) ??
    normalizeLocale(req.headers.get("accept-language")?.split(",")[0]) ??
    "en-US";

  try {
    let tokenResult;
    try {
      tokenResult = await exchangeCodeForToken(shop, code);
    } catch (exchangeErr) {
      const msg = exchangeErr instanceof Error ? exchangeErr.message : "";
      if (msg.includes("already used") || msg.includes("invalid_request")) {
        console.warn("[auth/shopify/callback] Auth code expired or reused, restarting OAuth");
        const retryUrl =
          `${APP_URL}/api/auth/shopify?shop=${encodeURIComponent(shop)}` +
          `&source=${source}&return_to=${encodeURIComponent(returnTo || "")}`;
        return NextResponse.redirect(retryUrl);
      }
      throw exchangeErr;
    }

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

      registerDisputeWebhooks({
        shopDomain: shop,
        accessToken: tokenResult.accessToken,
      })
        .then((result) => {
          if (!result.ok && result.errors.length) {
            console.warn("[webhooks] Dispute webhook registration:", result.errors);
          }
        })
        .catch((err) => {
          console.warn("[webhooks] Dispute webhook registration failed:", err?.message ?? err);
        });

      if (source === "portal") {
        const destination =
          returnTo && returnTo !== "/portal/select-store"
            ? returnTo
            : "/portal/dashboard";

        const { actionLink } = await handlePortalOAuth(
          req,
          db,
          shopInternalId,
          locale,
          destination,
        );

        await ensureShopSetup(db, shopInternalId);

        if (actionLink) {
          // Unauthenticated user — redirect to Supabase action_link for instant sign-in.
          // Cookies set here are stored by the browser before it follows the redirect chain.
          const res = NextResponse.redirect(actionLink);
          res.cookies.set("active_shop_id", shopInternalId, PORTAL_COOKIE_OPTS);
          res.cookies.set("dd_active_shop", shopInternalId, PORTAL_COOKIE_OPTS);
          return res;
        }

        // Already signed in — go straight to destination.
        const res = NextResponse.redirect(new URL(destination, req.url));
        res.cookies.set("active_shop_id", shopInternalId, PORTAL_COOKIE_OPTS);
        res.cookies.set("dd_active_shop", shopInternalId, PORTAL_COOKIE_OPTS);
        return res;
      }

      const onlineAuthUrl = `${APP_URL}/api/auth/shopify?shop=${shop}&phase=online`;
      return NextResponse.redirect(onlineAuthUrl);
    }

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

    // Mark permissions step done for embedded installs (portal handles this above).
    await ensureShopSetup(db, shopInternalId);

    // Redirect back into the embedded app. A server-side redirect to
    // admin.shopify.com would be blocked by X-Frame-Options when the OAuth
    // callback loads inside the Shopify Admin iframe. Instead, return a small
    // HTML page that uses `window.top.location` to break out of the iframe.
    const storeHandle = shop.replace(".myshopify.com", "");
    const embeddedUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${process.env.SHOPIFY_API_KEY}`;
    const html = `<!DOCTYPE html><html><head><script>window.top.location.href=${JSON.stringify(embeddedUrl)};</script></head><body></body></html>`;
    const res = new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html;charset=UTF-8" },
    });
    res.cookies.set("shopify_shop", shop, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    res.cookies.set("shopify_shop_id", shopInternalId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    // Short-lived grace marker. The embedded iframe reload that follows
    // window.top.location.href can race ahead of the Set-Cookie commit in
    // some browsers (CHIPS timing), so middleware uses this single-use
    // marker to avoid bouncing the iframe back through OAuth.
    res.cookies.set("dd_oauth_in_progress", "1", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      maxAge: 60,
      path: "/",
    });
    return res;
  } catch (err) {
    console.error("[auth/shopify/callback] Unhandled error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "OAuth callback failed", detail: message },
      { status: 500 }
    );
  }
}

/**
 * Handle the portal-source OAuth path:
 * - If a Supabase session is present in the request cookies, link the shop to
 *   the signed-in user (existing behaviour, with fixes).
 * - If no session is found, identify or create the Supabase user from the shop
 *   owner's email and return a Supabase action_link for instant sign-in.
 *
 * Returns { actionLink } — non-null when the caller should redirect to it.
 */
async function handlePortalOAuth(
  req: NextRequest,
  db: ReturnType<typeof getServiceClient>,
  shopId: string,
  locale: Locale,
  destination: string,
): Promise<{ actionLink: string | null }> {
  const { createServerClient } = await import("@supabase/ssr");

  // Check for an existing Supabase session in the request cookies.
  const anonSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user: sessionUser } } = await anonSupabase.auth.getUser();

  if (sessionUser) {
    // --- Already signed in: link shop and send emails ---
    const isFirstShop = await linkShopToUser(db, sessionUser.id, shopId);

    if (isFirstShop && sessionUser.email) {
      const fullName =
        (sessionUser.user_metadata?.full_name as string | undefined)?.trim() || undefined;
      await Promise.allSettled([
        sendWelcomeEmail({
          to: sessionUser.email,
          fullName,
          idempotencyKey: `welcome/${sessionUser.id}`,
          locale,
        }),
        sendAdminSignupNotification({ email: sessionUser.email, fullName }),
      ]);
    }

    return { actionLink: null };
  }

  // --- No session: identify/create user via shop owner email ---
  const shopDetails = await fetchShopDetails(shopId);
  if (!shopDetails?.email) {
    console.warn("[portal OAuth] Could not fetch shop owner email — shop linked without user");
    return { actionLink: null };
  }

  const shopEmail = shopDetails.email;
  const redirectTo = `${APP_URL}${destination}`;
  const adminSupabase = db; // service role client supports auth.admin

  // Try sign-up first (new user). Falls back to magic link for existing users.
  let userId: string;
  let isNewUser = false;
  let actionLink: string;

  const signupResult = await adminSupabase.auth.admin.generateLink({
    type: "signup",
    email: shopEmail,
    // Password is required by the SDK but will never be used — the user always
    // authenticates via Shopify OAuth. A random 32-byte token satisfies the requirement.
    password: crypto.randomBytes(32).toString("hex"),
    options: { redirectTo },
  });

  if (!signupResult.error) {
    userId = signupResult.data.user.id;
    actionLink = signupResult.data.properties.action_link;
    isNewUser = true;
  } else {
    // User already exists — generate a magic-link sign-in instead.
    const magicResult = await adminSupabase.auth.admin.generateLink({
      type: "magiclink",
      email: shopEmail,
      options: { redirectTo },
    });

    if (magicResult.error || !magicResult.data.properties.action_link) {
      console.error("[portal OAuth] generateLink failed:", magicResult.error?.message);
      return { actionLink: null };
    }

    userId = magicResult.data.user.id;
    actionLink = magicResult.data.properties.action_link;
  }

  // Link the shop to the user (upsert — safe to call for both new and existing).
  const isFirstShop = await linkShopToUser(db, userId, shopId);

  if (isNewUser || isFirstShop) {
    await Promise.allSettled([
      sendWelcomeEmail({
        to: shopEmail,
        idempotencyKey: `welcome-shopify/${userId}`,
        locale,
      }),
      sendAdminSignupNotification({ email: shopEmail }),
    ]);
  }

  return { actionLink };
}

/**
 * Upserts the portal_user_shops record and returns true if this is the user's
 * first linked shop (used to gate welcome email / admin notification).
 */
async function linkShopToUser(
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  shopId: string,
): Promise<boolean> {
  const { count } = await db
    .from("portal_user_shops")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const isFirstShop = (count ?? 0) === 0;

  await db.from("portal_user_shops").upsert(
    { user_id: userId, shop_id: shopId, role: "admin" },
    { onConflict: "user_id,shop_id" }
  );

  return isFirstShop;
}

async function ensureShopSetup(
  db: ReturnType<typeof getServiceClient>,
  shopId: string
) {
  const { data: existing } = await db
    .from("shop_setup")
    .select("shop_id, steps")
    .eq("shop_id", shopId)
    .single();

  const permissionsDone = {
    status: "done",
    completed_at: new Date().toISOString(),
    payload: { auto: true, trigger: "oauth_callback" },
  };

  if (!existing) {
    await db.from("shop_setup").insert({
      shop_id: shopId,
      steps: { permissions: permissionsDone },
      current_step: "permissions",
    });
  } else {
    const steps = (existing.steps ?? {}) as Record<string, unknown>;
    const alreadyDone =
      steps.permissions &&
      (steps.permissions as { status?: string }).status === "done";
    if (!alreadyDone) {
      steps.permissions = permissionsDone;
      await db
        .from("shop_setup")
        .update({
          steps,
          current_step: "permissions",
          updated_at: new Date().toISOString(),
        })
        .eq("shop_id", shopId);
    }
  }
}

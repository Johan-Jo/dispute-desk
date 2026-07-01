import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyHmac, exchangeCodeForToken, decodeOAuthState } from "@/lib/shopify/auth";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { registerOrderWebhooks } from "@/lib/shopify/registerOrderWebhooks";
import { registerWebPixel } from "@/lib/liabilityShift/sessions/registerWebPixel";
import { enqueueShopDailyMetricsBackfill } from "@/lib/disputes/backfillShopDailyMetrics";
import {
  enqueueShopOrdersBackfill,
  resetBackfillIfScopeUpgraded,
} from "@/lib/disputes/backfillOrders";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";
import { persistShopCurrency } from "@/lib/shopify/persistShopCurrency";
import { ingestShopifyPolicies } from "@/lib/policies/ingestShopifyPolicies";
import { grantFreeLifetimeCredits } from "@/lib/billing/grantFreeLifetime";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";
import {
  sendAdminSignupNotification,
  sendAdminInstallNotification,
} from "@/lib/email/sendAdminNotification";
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

  const { phase, source, returnTo, plan } = oauthState;

  // Resolve locale for emails: dd_locale cookie → Accept-Language → en
  const cookieStore = await cookies();
  const locale: Locale =
    normalizeLocale(cookieStore.get("dd_locale")?.value) ??
    normalizeLocale(req.headers.get("accept-language")?.split(",")[0]) ??
    "en";

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
    // True only when this OAuth callback creates the shops row for the first
    // time — i.e. a brand-new merchant install. Gates the admin install
    // notification so re-installs / re-OAuth don't re-notify.
    let isNewShop = false;

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
      isNewShop = true;
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

      // Admin install notification — fires once per NEW merchant, on the
      // offline OAuth phase (the first phase of every install, portal AND
      // embedded). Source-independent so an App Store install can no longer
      // go unannounced (unlike sendAdminSignupNotification, which is gated on
      // source === "portal"). Fire-and-forget: never blocks OAuth, and the
      // helper itself swallows errors. fetchShopDetails works here because the
      // offline session was just stored above.
      if (isNewShop) {
        // Free-tier lifetime pack floor — grant N usable packs once per
        // new shop so the Free plan isn't blocked at its first pack build.
        // Idempotent (guards on an existing free_lifetime ledger row), so
        // re-install can't double-grant. Fire-and-forget: never blocks OAuth.
        grantFreeLifetimeCredits(shopInternalId).catch((err) => {
          console.warn(
            "[billing] free_lifetime grant failed:",
            err instanceof Error ? err.message : err,
          );
        });

        fetchShopDetails(shopInternalId)
          .then((details) =>
            sendAdminInstallNotification({
              shopDomain: shop,
              email: details?.email,
              shopName: details?.name,
              source,
            }),
          )
          .catch((err) => {
            console.warn(
              "[email:admin-install] notification failed:",
              err instanceof Error ? err.message : err,
            );
          });
      }

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

      // PR-A: register orders/create + orders/updated webhooks so we
      // capture every order's pre-auth risk assessment in real time,
      // not just the historical backfill window.
      registerOrderWebhooks({
        shopDomain: shop,
        accessToken: tokenResult.accessToken,
      })
        .then((result) => {
          if (!result.ok && result.errors.length) {
            console.warn("[webhooks] Order webhook registration:", result.errors);
          }
        })
        .catch((err) => {
          console.warn("[webhooks] Order webhook registration failed:", err?.message ?? err);
        });

      // Populate shops.currency_code from the Shop GraphQL object.
      // Fire-and-forget — drives dashboard display currency, but a
      // miss falls back to the legacy heuristic so OAuth latency is
      // unaffected.
      persistShopCurrency(shopInternalId).catch((err) => {
        console.warn(
          "[shops] currency persist failed:",
          err instanceof Error ? err.message : err,
        );
      });

      // Auto-ingest the merchant's PUBLISHED store policies (Shop.shopPolicies)
      // into policy_snapshots as `shopify_published` evidence. Zero merchant
      // effort: the policy step is pre-filled with the live, citable versions.
      // Fire-and-forget — runs after storeSession (needs the offline session),
      // idempotent (dedup on content hash), and graceful on failure.
      ingestShopifyPolicies(shopInternalId).catch((err) => {
        console.warn(
          "[policies] published-policy ingest failed:",
          err instanceof Error ? err.message : err,
        );
      });

      // Kick off the 90-day chargeback-rate backfill. Idempotent: the
      // helper skips when shop_daily_metrics already has rows for this
      // shop, so re-installs after uninstall don't re-pay the cost.
      // Fire-and-forget — backfill runs in the worker, not on this
      // request path, so OAuth latency is unaffected.
      enqueueShopDailyMetricsBackfill(shopInternalId).catch((err) => {
        console.warn(
          "[shop_daily_metrics] backfill enqueue failed:",
          err instanceof Error ? err.message : err,
        );
      });

      // LSE-4: register the dispute-desk-pixel Web Pixel extension on
      // this shop via the webPixelCreate mutation. App pixels don't
      // auto-activate on install — without this call the pixel appears
      // in the released app version but never shows up in Admin →
      // Settings → Customer events. Idempotent: re-installs hit the
      // "already exists" path and silently no-op.
      registerWebPixel(shopInternalId)
        .then((result) => {
          if (result.status === "created") {
            console.info(
              `[lse4] dispute-desk-pixel registered on shop ${shopInternalId}: ${result.webPixelId}`,
            );
          } else if (result.status === "error") {
            console.warn(
              `[lse4] webPixelCreate failed on shop ${shopInternalId}: ${result.errorMessage}`,
            );
          }
        })
        .catch((err) => {
          console.warn(
            "[lse4] webPixelCreate threw:",
            err instanceof Error ? err.message : err,
          );
        });

      // Kick off the historical-orders backfill — Phase 1 fraud
      // intelligence. Idempotent: the helper skips when a backfill
      // is already queued/running or when historical_import_status
      // is already 'complete'.
      //
      // Scope-upgrade detection: if the merchant just re-OAuthed and
      // the new offline session includes `read_all_orders` (and the
      // prior run was on `default_window`), reset historical-import
      // state to `not_started` so the re-enqueue actually runs the
      // wider-window backfill. Idempotent — no-op on first install,
      // re-installs without scope change, or in-flight backfills.
      resetBackfillIfScopeUpgraded(shopInternalId, tokenResult.scope)
        .then(() => enqueueShopOrdersBackfill(shopInternalId))
        .catch((err) => {
          console.warn(
            "[fraud-intel] orders backfill enqueue failed:",
            err instanceof Error ? err.message : err,
          );
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

      // Carry the chosen plan into the online phase so the final embedded
      // redirect can deep-link the merchant to the in-app upgrade screen.
      const planQuery = plan ? `&plan=${encodeURIComponent(plan)}` : "";
      const onlineAuthUrl = `${APP_URL}/api/auth/shopify?shop=${shop}&phase=online${planQuery}`;
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
    // When the merchant chose a paid plan on the marketing pricing page, deep-link
    // them into the onboarding wizard carrying `plan`. The embedded root reads
    // `ddredirect`, carries `plan` through to /app/setup, which stashes it in
    // sessionStorage so it survives the wizard. Plan selection is then the FINAL
    // step — confirmed on the post-wizard completion screen — instead of an
    // instant /billing auto-upgrade (which Chrome blocked: a cross-origin
    // top-frame redirect from a fetch callback with no user gesture). Shopify's
    // billing approval still requires a merchant click; we can't pre-charge.
    const ddredirect = plan
      ? `?ddredirect=${encodeURIComponent(`/setup?plan=${plan}`)}`
      : "";
    const embeddedUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${process.env.SHOPIFY_API_KEY}${ddredirect}`;
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

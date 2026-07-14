import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession, loadSession } from "@/lib/shopify/sessionStorage";
import { verifySessionToken } from "@/lib/shopify/sessionToken";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { persistShopCurrency } from "@/lib/shopify/persistShopCurrency";
import { needsRefresh } from "@/lib/shopify/sessions/refreshOfflineToken";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY ?? "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET ?? "";

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const OFFLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";

/**
 * GET /api/auth/shopify/token-exchange?id_token=...&shop=...&host=...&return_to=...
 *
 * Completes Shopify's embedded-app authentication using Session Token
 * Exchange. Replaces the legacy OAuth redirect dance for any client
 * (iOS Shopify mobile app, mobile Safari, embedded desktop iframe) where
 * the cookie-based callback flow can't complete — the id_token is
 * already handed to us by Shopify on every embedded load, so we trade
 * it for a long-lived offline access token server-side.
 *
 * On success: stores (or reuses) the offline session, sets
 * shopify_shop + shopify_shop_id cookies, and 307s back to `return_to`
 * (typically `/app`). On failure: renders a minimal error HTML page
 * inside the iframe — never loops back to `/app`, to avoid a white
 * screen retry storm in the mobile WebView.
 */
export async function GET(req: NextRequest) {
  const idToken = req.nextUrl.searchParams.get("id_token");
  const shopParam = req.nextUrl.searchParams.get("shop");
  const hostParam = req.nextUrl.searchParams.get("host") ?? "";
  const returnTo = req.nextUrl.searchParams.get("return_to") || "/app";

  if (!idToken || !shopParam) {
    return errorPage("Missing id_token or shop parameter.");
  }

  const verified = verifySessionToken(idToken);
  if (!verified) {
    return errorPage("Session token is invalid or expired.");
  }
  if (verified.shopDomain !== shopParam.toLowerCase()) {
    return errorPage("Session token does not match the shop in the URL.");
  }

  const shop = verified.shopDomain;
  const db = getServiceClient();

  // Upsert the shop row so we have an internal id to hang the session on.
  let shopInternalId: string;
  {
    const { data: existing } = await db
      .from("shops")
      .select("id")
      .eq("shop_domain", shop)
      .maybeSingle();

    if (existing) {
      shopInternalId = existing.id;
      await db
        .from("shops")
        .update({ uninstalled_at: null, updated_at: new Date().toISOString() })
        .eq("id", shopInternalId);
    } else {
      const { data: created, error } = await db
        .from("shops")
        .insert({ shop_domain: shop })
        .select("id")
        .single();
      if (error || !created) {
        return errorPage(`Failed to create shop row: ${error?.message ?? "unknown"}`);
      }
      shopInternalId = created.id;
    }
  }

  // If we already have an offline session for this shop that's already
  // the expiring-token variant AND its access token is still fresh, skip
  // the exchange entirely — the id_token only authenticates *this
  // request*; a valid persisted access token stays usable across loads.
  //
  // We re-exchange (using this request's id_token) in three cases:
  //   - no existing session,
  //   - a LEGACY (non-expiring) session — upgraded in place to the
  //     expiring variant (docs/plans/expiring-offline-tokens.plan.md
  //     Stage 3); Shopify now rejects legacy tokens for Admin API calls,
  //   - an expiring session whose access token is EXPIRED / within the
  //     refresh skew (`needsRefresh`). The expiring design relies on a
  //     BACKGROUND refresh (grant_type=refresh_token) to keep the ~1h
  //     access token fresh, but if that never runs (e.g. an environment
  //     with the job worker disabled) the token goes stale and every
  //     Admin call fails. An embedded load is a free opportunity to mint
  //     a fresh pair server-side, so recover here rather than stranding
  //     the shop on a dead token.
  // Exchanging revokes the old token on Shopify's side, so the new pair
  // is persisted before this handler returns success.
  const existing = await loadSession(shopInternalId, "offline");
  // Threaded into every buildSuccessRedirect call below so the
  // dd_token_expiring cookie (middleware's short-circuit for the
  // Stage-3 re-check redirect) always reflects the ACTUAL persisted
  // state, not an assumption.
  let finalTokenExpiring = existing?.tokenExpiring ?? false;

  if (!existing || !existing.tokenExpiring || needsRefresh(existing)) {
    try {
      const exchangeRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          grant_type: GRANT_TYPE,
          subject_token: idToken,
          subject_token_type: SUBJECT_TOKEN_TYPE,
          requested_token_type: OFFLINE_TOKEN_TYPE,
          expiring: "1",
        }),
      });

      if (!exchangeRes.ok) {
        const body = await exchangeRes.text();
        console.error("[token-exchange] Shopify rejected exchange:", exchangeRes.status, body);
        // A legacy session that failed to upgrade still has its (soon
        // to be fully rejected) token — don't error the whole request
        // out from under an otherwise-working install; only hard-fail
        // when there was no prior session to fall back on.
        if (existing) {
          return buildSuccessRedirect(req, {
            returnTo,
            hostParam,
            shop,
            shopInternalId,
            tokenExpiring: finalTokenExpiring,
          });
        }
        return errorPage(`Shopify rejected token exchange (${exchangeRes.status}).`);
      }

      const data = (await exchangeRes.json()) as {
        access_token: string;
        scope: string;
        expires_in?: number;
        refresh_token?: string;
        refresh_token_expires_in?: number;
      };

      const nowMs = Date.now();
      const tokenExpiring = Boolean(data.expires_in && data.refresh_token);
      finalTokenExpiring = tokenExpiring;

      await storeSession({
        shopInternalId,
        shopDomain: shop,
        sessionType: "offline",
        userId: null,
        accessToken: data.access_token,
        scopes: data.scope,
        expiresAt: data.expires_in
          ? new Date(nowMs + data.expires_in * 1000).toISOString()
          : null,
        refreshToken: data.refresh_token ?? null,
        refreshTokenExpiresAt: data.refresh_token_expires_in
          ? new Date(nowMs + data.refresh_token_expires_in * 1000).toISOString()
          : null,
        tokenExpiring,
      });

      // Register dispute webhooks out-of-band; don't block the redirect.
      registerDisputeWebhooks({ shopDomain: shop, accessToken: data.access_token })
        .then((result) => {
          if (!result.ok && result.errors.length) {
            console.warn("[webhooks] Dispute webhook registration:", result.errors);
          }
        })
        .catch((err) => {
          console.warn("[webhooks] Dispute webhook registration failed:", err?.message ?? err);
        });

      // Populate shops.currency_code on first install via this path.
      // Fire-and-forget; failure is non-fatal (metrics layer falls
      // back to most-frequent dispute currency).
      persistShopCurrency(shopInternalId).catch((err) => {
        console.warn(
          "[shops] currency persist failed:",
          err instanceof Error ? err.message : err,
        );
      });
    } catch (err) {
      console.error("[token-exchange] Unhandled error:", err);
      // Same graceful-degradation as the !exchangeRes.ok branch above —
      // a transient failure upgrading a legacy session shouldn't break
      // an otherwise-working install.
      if (existing) {
        return buildSuccessRedirect(req, {
          returnTo,
          hostParam,
          shop,
          shopInternalId,
          tokenExpiring: finalTokenExpiring,
        });
      }
      return errorPage(err instanceof Error ? err.message : "Token exchange failed.");
    }
  }

  return buildSuccessRedirect(req, {
    returnTo,
    hostParam,
    shop,
    shopInternalId,
    tokenExpiring: finalTokenExpiring,
  });
}

/**
 * Build the final /app redirect preserving shop + host + embedded so
 * the embedded root has the params it needs (App Bridge, etc.), and set
 * the shopify_shop / shopify_shop_id cookies. Shared by the normal
 * success path and the "upgrade exchange failed but a usable legacy
 * session still exists" fallback.
 *
 * Also sets `dd_token_expiring` to the ACTUAL persisted state — never
 * assumed. `middleware.ts` reads this to short-circuit its Stage-3
 * re-check redirect once a shop's session is confirmed on the expiring
 * variant; a legacy session (`tokenExpiring: false`) writes "0" so the
 * next embedded load retries the upgrade instead of silently giving up.
 */
function buildSuccessRedirect(
  req: NextRequest,
  params: {
    returnTo: string;
    hostParam: string;
    shop: string;
    shopInternalId: string;
    tokenExpiring: boolean;
  },
): NextResponse {
  const dest = safeReturnTo(params.returnTo);
  const destUrl = new URL(dest, req.url);
  if (!destUrl.searchParams.has("shop")) destUrl.searchParams.set("shop", params.shop);
  if (params.hostParam && !destUrl.searchParams.has("host")) {
    destUrl.searchParams.set("host", params.hostParam);
  }
  if (!destUrl.searchParams.has("embedded")) destUrl.searchParams.set("embedded", "1");

  const res = NextResponse.redirect(destUrl);
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  };
  res.cookies.set("shopify_shop", params.shop, cookieOpts);
  res.cookies.set("shopify_shop_id", params.shopInternalId, cookieOpts);
  res.cookies.set("dd_token_expiring", params.tokenExpiring ? "1" : "0", cookieOpts);
  return res;
}

/**
 * Only allow in-app return paths. An open-redirect-safe version of
 * `return_to` handling; anything else falls back to `/app`.
 */
function safeReturnTo(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

function errorPage(message: string): NextResponse {
  const body = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DisputeDesk — sign-in error</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;padding:2rem;color:#202223;max-width:36rem;margin:auto}h1{font-size:1.125rem;margin:0 0 .5rem}p{margin:.25rem 0;color:#6d7175}</style>
</head><body><h1>Couldn't sign you into DisputeDesk</h1>
<p>${escapeHtml(message)}</p>
<p>Please reopen the app from your Shopify admin. If the problem keeps happening, contact support@disputedesk.app.</p>
</body></html>`;
  return new NextResponse(body, {
    status: 401,
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

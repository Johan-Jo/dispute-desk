import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { storeSession, loadSession } from "@/lib/shopify/sessionStorage";
import { verifySessionToken } from "@/lib/shopify/sessionToken";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";

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

  // If we already have an offline session for this shop we can skip the
  // exchange entirely — the id_token only authenticates *this request*;
  // persisted access tokens stay valid across app loads.
  const existing = await loadSession(shopInternalId, "offline");

  if (!existing) {
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
        }),
      });

      if (!exchangeRes.ok) {
        const body = await exchangeRes.text();
        console.error("[token-exchange] Shopify rejected exchange:", exchangeRes.status, body);
        return errorPage(`Shopify rejected token exchange (${exchangeRes.status}).`);
      }

      const data = (await exchangeRes.json()) as { access_token: string; scope: string };

      await storeSession({
        shopInternalId,
        shopDomain: shop,
        sessionType: "offline",
        userId: null,
        accessToken: data.access_token,
        scopes: data.scope,
        expiresAt: null,
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
    } catch (err) {
      console.error("[token-exchange] Unhandled error:", err);
      return errorPage(err instanceof Error ? err.message : "Token exchange failed.");
    }
  }

  // Build the final /app URL preserving shop + host + embedded so the
  // embedded root has the params it needs (App Bridge, etc.).
  const dest = safeReturnTo(returnTo);
  const destUrl = new URL(dest, req.url);
  if (!destUrl.searchParams.has("shop")) destUrl.searchParams.set("shop", shop);
  if (hostParam && !destUrl.searchParams.has("host")) destUrl.searchParams.set("host", hostParam);
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
  res.cookies.set("shopify_shop", shop, cookieOpts);
  res.cookies.set("shopify_shop_id", shopInternalId, cookieOpts);
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

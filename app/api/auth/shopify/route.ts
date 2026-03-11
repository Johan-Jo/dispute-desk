import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, generateNonce, encodeOAuthState } from "@/lib/shopify/auth";

/**
 * GET /api/auth/shopify?shop=xxx.myshopify.com[&source=portal&return_to=/portal/select-store]
 *
 * Initiates Shopify OAuth. Encodes phase/source/return_to in a signed state
 * token so the callback can recover them without cookies (which are unreliable
 * across cross-site redirects).
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

  const phase = req.nextUrl.searchParams.get("phase") ?? "offline";
  const isOnline = phase === "online";
  const source = req.nextUrl.searchParams.get("source") ?? "embedded";
  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "";

  const nonce = generateNonce();
  const stateToken = encodeOAuthState({ nonce, phase, source, returnTo });

  const authUrl = buildAuthUrl(shop, stateToken, isOnline);
  const host = req.nextUrl.searchParams.get("host") ?? "";

  // When loaded in the embedded app iframe, a 302 to Shopify would load admin.shopify.com
  // inside the iframe, which is blocked. Use App Bridge so the parent frame performs the redirect.
  const inIframe = req.headers.get("sec-fetch-dest") === "iframe";
  const fromEmbedded = source === "embedded";
  const referer = req.headers.get("referer");
  const refererIsOurApp =
    referer && appUrl && new URL(referer).origin === new URL(appUrl).origin;
  if (inIframe || fromEmbedded || refererIsOurApp) {
    // With host: load App Bridge and redirect via window.open(url, '_top') so the parent navigates.
    const safeAuthUrl = authUrl.replace(/</g, "\\u003c");
    const safeApiKey = (apiKey ?? "").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const safeHost = (host ?? "").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
    const metaHost = safeHost ? `<meta name="shopify-host" content="${safeHost}">` : "";
    const dataHost = safeHost ? ` data-host="${safeHost}"` : "";
    const redirectScript = host
      ? `(function(){var u=${JSON.stringify(safeAuthUrl)};function go(){try{if(typeof window.shopify!=='undefined'&&window.shopify.navigation&&typeof window.shopify.navigation.open==='function'){window.shopify.navigation.open(u,'_top');}else{window.open(u,'_top');}}catch(e){window.open(u,'_top');}}var t=0;var i=setInterval(function(){if(typeof window.shopify!=='undefined'){clearInterval(i);go();}else if(++t>30){clearInterval(i);go();}},100);})();`
      : "";
    const fallbackLink = `<p style="margin-top:1rem;font-size:0.875rem;color:#666">If the app did not open, <a href=${JSON.stringify(authUrl)} target="_top" rel="noopener">click here to continue to Shopify</a>.</p>`;
    const mainCta = host ? "" : `<a href=${JSON.stringify(authUrl)} target="_top" rel="noopener" style="display:inline-block;padding:12px 24px;background:#008060;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:1rem">Continue to Shopify</a>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="shopify-api-key" content="${safeApiKey}">${metaHost}</head><body style="font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;box-sizing:border-box"><p style="margin-bottom:1rem;color:#333">${host ? "Redirecting to Shopify…" : "Open DisputeDesk in Shopify"}</p>${redirectScript ? `<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="${safeApiKey}"${dataHost}"></script><script>${redirectScript}</script>` : ""}${mainCta}${host ? fallbackLink : `<p style="margin-top:1rem;font-size:0.875rem;color:#666">Click the button above to sign in and open the app.</p>`}</body></html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.redirect(authUrl);
}

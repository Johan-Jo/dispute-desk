import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/shopify/start?shop=xxx.myshopify.com
 *
 * Breaks out of iframe and loads /api/auth/shopify in the top-level window.
 * Ensures the OAuth state cookie is set in a first-party (top-level) context
 * so it is sent when Shopify redirects back to the callback.
 */
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop || !shop.endsWith(".myshopify.com")) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter" },
      { status: 400 }
    );
  }

  const appUrl = process.env.SHOPIFY_APP_URL ?? req.nextUrl.origin;
  const authUrl = `${appUrl}/api/auth/shopify?shop=${encodeURIComponent(shop)}`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading…</title></head><body><p>Loading…</p><script>window.top.location.href=${JSON.stringify(authUrl)};</script></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

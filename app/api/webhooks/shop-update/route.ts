import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/webhooks/shop-update
 *
 * Handles shop/update webhook. Updates shop domain if changed.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    console.warn("[webhook] HMAC verification failed for shop/update");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const shopDomain = payload?.myshopify_domain;

  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const db = getServiceClient();
  await db
    .from("shops")
    .update({ updated_at: new Date().toISOString() })
    .eq("shop_domain", shopDomain);

  // TODO: attempt to register disputes/create or disputes/update webhook
  // if available for API version 2026-01. Log if registration fails.

  return NextResponse.json({ ok: true });
}

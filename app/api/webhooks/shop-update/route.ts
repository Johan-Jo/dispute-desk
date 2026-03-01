import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";

/**
 * POST /api/webhooks/shop-update
 *
 * Handles shop/update webhook. Updates shop domain if changed.
 * Re-registers dispute webhooks so subscriptions are restored if dropped.
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

  // Re-register dispute webhooks (e.g. if subscriptions were dropped after reinstall)
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .single();

  if (shop) {
    const session = await loadSession(shop.id, "offline");
    if (session?.accessToken) {
      registerDisputeWebhooks({
        shopDomain,
        accessToken: session.accessToken,
      })
        .then((result) => {
          if (!result.ok && result.errors.length) {
            console.warn(
              "[webhooks] shop/update dispute webhook registration:",
              result.errors
            );
          }
        })
        .catch((err) => {
          console.warn(
            "[webhooks] shop/update dispute webhook registration failed:",
            err?.message ?? err
          );
        });
    }
  }

  return NextResponse.json({ ok: true });
}

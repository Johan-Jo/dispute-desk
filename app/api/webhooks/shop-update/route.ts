import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { ensureFreshSession } from "@/lib/shopify/sessions/refreshOfflineToken";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { persistShopCurrency } from "@/lib/shopify/persistShopCurrency";

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

  // The shop/update payload includes the shop's primary currency
  // directly (`currency`), so we update from the payload synchronously
  // here. If the field is absent we fall back to a GraphQL fetch
  // below.
  const payloadCurrency =
    typeof payload?.currency === "string" && /^[A-Z]{3}$/.test(payload.currency)
      ? payload.currency
      : null;

  const db = getServiceClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payloadCurrency) update.currency_code = payloadCurrency;
  await db
    .from("shops")
    .update(update)
    .eq("shop_domain", shopDomain);

  // Re-register dispute webhooks (e.g. if subscriptions were dropped after reinstall)
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .single();

  if (shop) {
    const rawSession = await loadSession(shop.id, "offline");
    const session = rawSession ? await ensureFreshSession(rawSession) : null;
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

    // Backstop: if the webhook payload didn't carry `currency`, fall
    // back to a GraphQL fetch so the row still converges to truth.
    if (!payloadCurrency) {
      persistShopCurrency(shop.id).catch((err) => {
        console.warn(
          "[shops] shop/update currency persist failed:",
          err instanceof Error ? err.message : err,
        );
      });
    }
  }

  return NextResponse.json({ ok: true });
}

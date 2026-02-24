import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/webhooks/app-uninstalled
 *
 * Handles app/uninstalled webhook.
 * - Marks shop as uninstalled
 * - Deletes sessions (tokens)
 * - Retains dispute/pack/audit data for compliance
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    console.warn("[webhook] HMAC verification failed for app/uninstalled");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? payload?.myshopify_domain;

  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const db = getServiceClient();

  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .single();

  if (shop) {
    await db
      .from("shops")
      .update({ uninstalled_at: new Date().toISOString() })
      .eq("id", shop.id);

    await db
      .from("shop_sessions")
      .delete()
      .eq("shop_id", shop.id);

    // Cancel any queued/running jobs for this shop
    await db
      .from("jobs")
      .update({ status: "failed", last_error: "App uninstalled" })
      .eq("shop_id", shop.id)
      .in("status", ["queued", "running"]);
  }

  return NextResponse.json({ ok: true });
}

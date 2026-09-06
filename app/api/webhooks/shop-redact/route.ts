/**
 * POST /api/webhooks/shop/redact — GDPR mandatory webhook.
 *
 * Shopify sends this 48 hours after app uninstall. Per Shopify spec we must
 * delete all data associated with the shop.
 *
 * This used to walk a hardcoded table list with one PostgREST DELETE per
 * table, and it could not complete. Two defects, both fixed by delegating to
 * the `admin_purge_shop` SQL function:
 *
 *   1. **The append-only tables.** `audit_events` and `dispute_events` carry
 *      BEFORE DELETE triggers that refuse every delete. The loop logged
 *      `append-only: DELETE not allowed`, swallowed it, continued, and then
 *      failed to delete the `shops` row too (it is FK-referenced by the rows
 *      it had just failed to remove). Shops were left permanently
 *      half-redacted — a live compliance gap, not a cosmetic one.
 *   2. **No atomicity.** A sequence of PostgREST calls is not a transaction,
 *      so any mid-way failure stranded a partially-erased shop.
 *
 * `admin_purge_shop` runs the whole erasure in ONE transaction, sets the
 * transaction-scoped flag the append-only triggers honour, and discovers its
 * target tables from the FK graph — so a per-shop table added by a later
 * migration is covered automatically instead of silently surviving redaction.
 *
 * Re-delivery is idempotent: the function returns `unknown_shop` once the
 * row is gone, which we ack as success.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ShopRedactPayload {
  shop_id?: number;
  shop_domain?: string;
}


export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ShopRedactPayload = {};
  try {
    payload = JSON.parse(rawBody) as ShopRedactPayload;
  } catch {
    console.warn("[webhook] shop/redact: invalid JSON body");
    return NextResponse.json({ ok: true, skipped: "invalid_json" });
  }

  const shopDomain =
    req.headers.get("x-shopify-shop-domain") ?? payload.shop_domain ?? null;
  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (!shop) {
    // Already deleted, or never installed. Idempotent: ack and exit.
    return NextResponse.json({ ok: true, skipped: "unknown_shop" });
  }

  const shopId = shop.id;

  // Pre-deletion compliance breadcrumb. The shop's own audit rows are about
  // to be erased, so this server log is the record that survives if Shopify
  // ever asks whether the redaction ran.
  console.log(
    `[shop/redact] starting cascade for shop_id=${shopId} shop_domain=${shopDomain}`,
  );

  const { data, error } = await db.rpc("admin_purge_shop", { p_shop_id: shopId });

  if (error) {
    // Surface the failure: Shopify retries a non-2xx, and a silent 200 here
    // is exactly how the old implementation hid an incomplete redaction.
    console.error("[shop/redact] purge failed", {
      shopDomain,
      message: error.message,
    });
    return NextResponse.json({ error: "Redaction failed" }, { status: 500 });
  }

  console.log(
    `[shop/redact] cascade complete for shop_domain=${shopDomain}:`,
    JSON.stringify(data),
  );

  return NextResponse.json({ ok: true, purged: data });
}

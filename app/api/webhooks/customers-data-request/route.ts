/**
 * POST /api/webhooks/customers/data_request — GDPR mandatory webhook.
 *
 * Shopify forwards a customer's data subject access request (DSAR) to
 * us. Shopify expects a 200 acknowledgment within 30 days; the actual
 * data export is the merchant's responsibility under GDPR (the
 * merchant — not the app — is the data controller).
 *
 * Our implementation:
 *   1. Verify HMAC.
 *   2. Persist an audit_events row so the merchant has an evidence
 *      trail of the request.
 *   3. Email the shop's admin via Resend with the request details so
 *      they can respond inside their statutory window.
 *   4. Return 200.
 *
 * Re-delivery is harmless — multiple audit rows + emails for the same
 * request are acceptable; Shopify deduplicates on its side.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import { sendAdminEmail } from "@/lib/email/adminEmail";

export const runtime = "nodejs";

interface DataRequestPayload {
  shop_id?: number;
  shop_domain?: string;
  orders_requested?: Array<number | string>;
  customer?: {
    id?: number | string;
    email?: string;
    phone?: string;
  };
  data_request?: { id?: number };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: DataRequestPayload = {};
  try {
    payload = JSON.parse(rawBody) as DataRequestPayload;
  } catch {
    // Per Shopify docs, even malformed payloads should be acknowledged
    // to avoid retries; log and return 200.
    console.warn("[webhook] customers/data_request: invalid JSON body");
    return NextResponse.json({ ok: true, skipped: "invalid_json" });
  }

  const shopDomain =
    req.headers.get("x-shopify-shop-domain") ??
    payload.shop_domain ??
    null;
  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  // Always persist an audit row — even for unknown shops, the request
  // happened and Shopify expects ack regardless.
  await db.from("audit_events").insert({
    shop_id: shop?.id ?? null,
    actor_type: "system",
    event_type: "gdpr_data_request_received",
    event_payload: {
      shop_domain: shopDomain,
      customer_email: payload.customer?.email ?? null,
      customer_id: payload.customer?.id ?? null,
      orders_requested: payload.orders_requested ?? [],
      shopify_request_id: payload.data_request?.id ?? null,
    },
  });

  // Notify the merchant so they can respond within the statutory window.
  // Best-effort — email failure must not fail the webhook.
  try {
    const text =
      `Shopify forwarded a customer data request for store ${shopDomain}.\n\n` +
      `Customer email: ${payload.customer?.email ?? "(not provided)"}\n` +
      `Customer ID: ${payload.customer?.id ?? "(not provided)"}\n` +
      `Orders requested: ${JSON.stringify(payload.orders_requested ?? [])}\n` +
      `Shopify request ID: ${payload.data_request?.id ?? "(none)"}\n\n` +
      `You have a statutory window (30 days under GDPR) to respond directly to the customer with the data you hold for them.`;
    await sendAdminEmail({
      subject: `[GDPR] Data request received for ${shopDomain}`,
      logTag: "gdpr-data-request",
      text,
      html: `<p>Shopify forwarded a customer data request for store <b>${escapeHtml(shopDomain)}</b>.</p>
<p><b>Customer email:</b> ${escapeHtml(payload.customer?.email ?? "(not provided)")}<br>
<b>Customer ID:</b> ${escapeHtml(String(payload.customer?.id ?? "(not provided)"))}<br>
<b>Orders requested:</b> ${escapeHtml(JSON.stringify(payload.orders_requested ?? []))}<br>
<b>Shopify request ID:</b> ${escapeHtml(String(payload.data_request?.id ?? "(none)"))}</p>
<p>You have a statutory window (30 days under GDPR) to respond directly to the customer with the data you hold for them.</p>`,
    });
  } catch (err) {
    console.warn(
      "[webhook] customers/data_request: admin notification failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

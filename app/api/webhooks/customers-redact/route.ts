/**
 * POST /api/webhooks/customers/redact — GDPR mandatory webhook.
 *
 * Shopify forwards an erasure request for a specific customer. We
 * anonymize (not hard-delete) that customer's PII across our DB so
 * audit + financial records survive with no identifiable data — the
 * standard GDPR-compliant pattern for transactional records.
 *
 * Anonymization scope (per shop):
 *   - disputes.customer_email + disputes.customer_display_name → NULL
 *     for any dispute row whose customer_email matches the target.
 *   - evidence_packs.pack_json → recursively scrub email/name fields
 *     that match the target via lib/webhooks/scrubCustomerData.
 *   - audit_events row written for the redaction itself (compliance
 *     proof; no customer PII in the audit row beyond the customer_id
 *     reference Shopify supplied).
 *
 * Re-delivery is idempotent — anonymizing already-anonymized rows is
 * a no-op (NULL stays NULL; redacted JSON stays redacted).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import { scrubCustomerData, type ScrubTarget } from "@/lib/webhooks/scrubCustomerData";

export const runtime = "nodejs";

interface RedactPayload {
  shop_id?: number;
  shop_domain?: string;
  customer?: {
    id?: number | string;
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
  };
  orders_to_redact?: Array<number | string>;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: RedactPayload = {};
  try {
    payload = JSON.parse(rawBody) as RedactPayload;
  } catch {
    console.warn("[webhook] customers/redact: invalid JSON body");
    return NextResponse.json({ ok: true, skipped: "invalid_json" });
  }

  const shopDomain =
    req.headers.get("x-shopify-shop-domain") ?? payload.shop_domain ?? null;
  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const customerEmail = payload.customer?.email ?? null;
  const fullName = [payload.customer?.first_name, payload.customer?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const customerName = fullName.length > 0 ? fullName : null;

  if (!customerEmail && !customerName) {
    // Nothing to match on — Shopify expects 200 anyway. Log and ack.
    return NextResponse.json({ ok: true, skipped: "no_pii_to_match" });
  }

  const db = getServiceClient();
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (!shop) {
    // Unknown shop — nothing in our DB matches this redact request.
    // Still ack so Shopify doesn't retry.
    return NextResponse.json({ ok: true, skipped: "unknown_shop" });
  }

  const target: ScrubTarget = { email: customerEmail, name: customerName };

  // 1. Anonymize disputes rows for this customer in this shop.
  let disputesAnonymized = 0;
  if (customerEmail) {
    const { data: matched, error } = await db
      .from("disputes")
      .update({ customer_email: null, customer_display_name: null })
      .eq("shop_id", shop.id)
      .eq("customer_email", customerEmail)
      .select("id");
    if (!error && matched) {
      disputesAnonymized = matched.length;
    }
  }

  // 2. Scrub matching email/name fields out of every evidence_packs.pack_json
  //    for this shop. We scope by shop_id to keep the scan tight.
  const { data: packs } = await db
    .from("evidence_packs")
    .select("id, pack_json")
    .eq("shop_id", shop.id);

  let packsScrubbed = 0;
  for (const row of packs ?? []) {
    const original = (row as { pack_json?: unknown }).pack_json;
    if (!original) continue;
    const scrubbed = scrubCustomerData(original, target);
    if (JSON.stringify(scrubbed) !== JSON.stringify(original)) {
      await db
        .from("evidence_packs")
        .update({ pack_json: scrubbed })
        .eq("id", (row as { id: string }).id);
      packsScrubbed++;
    }
  }

  // 3. Compliance audit row — does NOT include the customer's email
  //    or name (would defeat the redact). We log only the Shopify
  //    customer ID reference + the counts of what we anonymized.
  await db.from("audit_events").insert({
    shop_id: shop.id,
    actor_type: "system",
    event_type: "gdpr_customer_redacted",
    event_payload: {
      shop_domain: shopDomain,
      customer_id: payload.customer?.id ?? null,
      disputes_anonymized: disputesAnonymized,
      packs_scrubbed: packsScrubbed,
    },
  });

  return NextResponse.json({
    ok: true,
    disputes_anonymized: disputesAnonymized,
    packs_scrubbed: packsScrubbed,
  });
}

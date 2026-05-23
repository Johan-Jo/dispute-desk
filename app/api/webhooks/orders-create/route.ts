import { NextRequest, NextResponse } from "next/server";
import { handleOrderWebhook } from "@/lib/webhooks/handleOrderWebhook";

/**
 * POST /api/webhooks/orders-create
 *
 * PR-A — orders ingest foundation. Fetches the order via GraphQL (same
 * shape as backfill), normalizes, and persists. Risk-payload hash gate
 * prevents duplicate assessment rows when re-fired.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const shopDomainHeader = req.headers.get("x-shopify-shop-domain");
  const webhookId = req.headers.get("x-shopify-webhook-id");

  let shopFromPayload: string | null = null;
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const d =
      payload.myshopify_domain ?? payload.shop_domain ?? payload.domain;
    shopFromPayload = typeof d === "string" ? d : null;
  } catch {
    // ignore — handler will short-circuit on JSON.parse failure
  }

  const result = await handleOrderWebhook({
    rawBody,
    headers: {
      hmac,
      shopDomain: shopDomainHeader,
      webhookId,
      topic: "orders/create",
    },
    shopDomainFromPayload: shopFromPayload,
  });

  return NextResponse.json(result.body, { status: result.status });
}

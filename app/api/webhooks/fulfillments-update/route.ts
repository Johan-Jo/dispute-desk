import { NextRequest, NextResponse } from "next/server";
import { handleFulfillmentWebhook } from "@/lib/webhooks/handleFulfillmentWebhook";

/**
 * POST /api/webhooks/fulfillments-update
 *
 * A carrier update on a disputed order rebuilds that case within minutes
 * (lib/webhooks/handleFulfillmentWebhook.ts). Registered at runtime by
 * registerOrderWebhooks; the hourly session-health cron repairs it.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleFulfillmentWebhook({
    rawBody,
    headers: {
      hmac: req.headers.get("x-shopify-hmac-sha256"),
      shopDomain: req.headers.get("x-shopify-shop-domain"),
      webhookId: req.headers.get("x-shopify-webhook-id"),
      topic: "fulfillments/update",
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}

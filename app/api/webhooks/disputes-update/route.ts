import { NextRequest, NextResponse } from "next/server";
import { handleDisputeWebhook } from "@/lib/webhooks/handleDisputeWebhook";

/**
 * POST /api/webhooks/disputes-update
 *
 * Webhook-primary path. See lib/webhooks/handleDisputeWebhook.ts for the
 * full pipeline (HMAC → shop lookup → Layer A delivery dedup → snapshot
 * normalization → applyDisputeSnapshot → dispatchDisputeEffects → mark
 * processed).
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

  const result = await handleDisputeWebhook({
    rawBody,
    headers: {
      hmac,
      shopDomain: shopDomainHeader,
      webhookId,
      topic: "disputes/update",
    },
    shopDomainFromPayload: shopFromPayload,
  });

  return NextResponse.json(result.body, { status: result.status });
}

import { NextRequest, NextResponse } from "next/server";
import { handleDisputeWebhook } from "@/lib/webhooks/handleDisputeWebhook";

/**
 * POST /api/webhooks/disputes-create
 *
 * Handles Shopify disputes/create webhook. Enqueues a sync_disputes job
 * for the shop so new disputes are synced without waiting for cron.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const shopDomainHeader = req.headers.get("x-shopify-shop-domain");

  let shopFromPayload: string | null = null;
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const d =
      payload.myshopify_domain ?? payload.shop_domain ?? payload.domain;
    shopFromPayload = typeof d === "string" ? d : null;
  } catch {
    // ignore
  }

  const result = await handleDisputeWebhook(
    rawBody,
    hmac,
    shopDomainHeader,
    shopFromPayload
  );

  return NextResponse.json(result.body, { status: result.status });
}

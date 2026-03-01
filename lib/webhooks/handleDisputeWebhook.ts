/**
 * Shared logic for disputes/create and disputes/update webhook handlers.
 * Verifies HMAC, resolves shop, optionally enqueues sync_disputes (with idempotency).
 */

import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";

export interface DisputeWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Handle an incoming dispute webhook (create or update).
 * Returns status and body for the HTTP response.
 */
export async function handleDisputeWebhook(
  rawBody: string,
  hmacHeader: string | null,
  shopDomainFromHeader: string | null,
  shopDomainFromPayload: string | null | undefined
): Promise<DisputeWebhookResult> {
  const hmac = hmacHeader ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  const shopDomain =
    shopDomainFromHeader ??
    (typeof shopDomainFromPayload === "string" ? shopDomainFromPayload : null);

  if (!shopDomain) {
    return { status: 400, body: { error: "Missing shop domain" } };
  }

  const db = getServiceClient();
  const { data: shop, error: shopError } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (shopError || !shop) {
    // Return 200 so Shopify does not retry for unknown/uninstalled shops
    return { status: 200, body: { ok: true, skipped: "unknown_shop" } };
  }

  const { data: existing } = await db
    .from("jobs")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("job_type", "sync_disputes")
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { status: 200, body: { ok: true, skipped: "job_already_queued" } };
  }

  const jobId = await enqueueJob({
    shopId: shop.id,
    jobType: "sync_disputes",
    entityId: shop.id,
    priority: 50,
  });

  return { status: 200, body: { ok: true, jobId } };
}

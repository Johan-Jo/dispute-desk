/**
 * Shared pipeline for fulfillment_events/create + fulfillments/update.
 *
 * A carrier update on a disputed order rebuilds that case within minutes
 * instead of waiting for the nightly refresh (see
 * `lib/disputes/rebuildOnCarrierUpdate.ts`).
 *
 * These topics fire for EVERY shipment of the shop, and almost none belong
 * to a disputed order — so the open-dispute lookup runs before anything is
 * written: an event for an undisputed order costs one indexed read and
 * leaves no webhook_events row.
 *
 * Pipeline:
 *   1. Verify HMAC.
 *   2. Resolve the shop (signed header).
 *   3. Order GID from the payload's `order_id`.
 *   4. Open disputes with a pack on that order — none → 200, done.
 *   5. Layer A delivery dedup via (shop_id, X-Shopify-Webhook-Id).
 *   6. Re-ingest the order + queue the rebuilds.
 *
 * 200 on every data problem so Shopify does not retry; 500 only when the
 * work itself failed (the retry is safe — a queued rebuild is not stacked).
 */

import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import {
  checkAndClaim,
  markProcessed,
  buildSafePayloadExcerpt,
  type WebhookOutcome,
} from "@/lib/webhooks/eventIdempotency";
import { resolveShopIdByDomain } from "@/lib/shopify/orderIngest";
import {
  openDisputesForOrder,
  rebuildOpenDisputesOnCarrierUpdate,
} from "@/lib/disputes/rebuildOnCarrierUpdate";

export interface FulfillmentWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface HandleFulfillmentWebhookArgs {
  rawBody: string;
  headers: {
    hmac: string | null;
    shopDomain: string | null;
    webhookId: string | null;
    topic: string;
  };
}

export async function handleFulfillmentWebhook(
  args: HandleFulfillmentWebhookArgs,
): Promise<FulfillmentWebhookResult> {
  const started = Date.now();
  const { rawBody, headers } = args;
  const topic = headers.topic;

  if (!verifyShopifyWebhook(rawBody, headers.hmac ?? "")) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawBody);
    payload =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }

  if (!headers.shopDomain) {
    return { status: 400, body: { error: "Missing shop domain" } };
  }
  const shopId = await resolveShopIdByDomain(headers.shopDomain);
  if (!shopId) {
    return { status: 200, body: { ok: true, skipped: "unknown_shop" } };
  }

  const orderId = payload?.["order_id"];
  if (typeof orderId !== "number" && typeof orderId !== "string") {
    return { status: 200, body: { ok: true, skipped: "missing_order_id" } };
  }
  const orderGid = String(orderId).startsWith("gid://")
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;

  let disputes;
  try {
    disputes = await openDisputesForOrder(shopId, orderGid);
  } catch (err) {
    return {
      status: 500,
      body: { error: "dispute_lookup_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }
  if (disputes.length === 0) {
    return { status: 200, body: { ok: true, skipped: "no_open_dispute" } };
  }

  // fulfillment_events/create carries the carrier status in `status`;
  // fulfillments/update carries it in `shipment_status`.
  const eventStatus =
    (typeof payload?.["shipment_status"] === "string" && (payload["shipment_status"] as string)) ||
    (typeof payload?.["status"] === "string" && (payload["status"] as string)) ||
    null;

  const eventId = headers.webhookId ?? `fallback:${topic}:${String(payload?.["id"] ?? orderId)}:${started}`;
  let eventRowId: string | null = null;
  try {
    const claim = await checkAndClaim({
      shopId,
      eventId,
      topic,
      shopifyObjectId: String(payload?.["admin_graphql_api_id"] ?? payload?.["id"] ?? orderGid),
      payloadExcerpt: buildSafePayloadExcerpt(payload),
    });
    if (claim.status === "duplicate") {
      return { status: 200, body: { ok: true, skipped: "duplicate_event" } };
    }
    eventRowId = claim.eventRowId;
  } catch (err) {
    return {
      status: 500,
      body: { error: "webhook_claim_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }

  const finalize = async (outcome: WebhookOutcome, errorMessage: string | null = null) => {
    if (!eventRowId) return;
    await markProcessed({ eventRowId, outcome, processingMs: Date.now() - started, errorMessage });
  };

  try {
    const result = await rebuildOpenDisputesOnCarrierUpdate({
      shopId,
      orderGid,
      disputes,
      trigger: `webhook_${topic.replace("/", "_")}`,
      correlationId: `webhook-${topic}-${eventId}`,
      eventStatus,
    });
    await finalize(result.rebuildsEnqueued > 0 ? "applied" : "skipped_unchanged");
    return { status: 200, body: { ok: true, ...result } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalize("error", msg);
    return { status: 500, body: { error: "processing_failed", message: msg } };
  }
}

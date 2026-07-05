/**
 * Shared direct-processing pipeline for orders/create + orders/updated (PR-A).
 *
 * Mirror of `handleDisputeWebhook` but for order ingest. Reuses the
 * existing HMAC verification, Layer A delivery idempotency, and
 * webhook_events outcome telemetry.
 *
 * Pipeline:
 *   1. Verify HMAC.
 *   2. Resolve shop by domain (signed header preferred over body).
 *   3. Layer A delivery dedup via (shop_id, X-Shopify-Webhook-Id).
 *   4. Build the order GID from payload (admin_graphql_api_id, falling
 *      back to `id`).
 *   5. Call `normalizeOrderIngest` — GraphQL fetch + normalize + persist
 *      gated by risk_payload_hash dedup.
 *   6. Map writer outcome to webhook outcome (applied | skipped_unchanged).
 *
 * Returns 200 in every recoverable case so Shopify doesn't retry on
 * data problems. Exceptions during the persist step surface as 500 →
 * Shopify retries (the hash dedup makes the retry safe).
 */

import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import {
  checkAndClaim,
  markProcessed,
  buildSafePayloadExcerpt,
  type WebhookOutcome,
} from "@/lib/webhooks/eventIdempotency";
import {
  normalizeOrderIngest,
  resolveShopIdByDomain,
} from "@/lib/shopify/orderIngest";
import { matchSessionToOrder } from "@/lib/liabilityShift/sessions/ingest";

export interface OrderWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface OrderWebhookHeaders {
  hmac: string | null;
  shopDomain: string | null;
  webhookId: string | null;
  topic: string;
}

export interface HandleOrderWebhookArgs {
  rawBody: string;
  headers: OrderWebhookHeaders;
  shopDomainFromPayload?: string | null;
}

export async function handleOrderWebhook(
  args: HandleOrderWebhookArgs,
): Promise<OrderWebhookResult> {
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

  const shopDomain =
    headers.shopDomain ??
    (typeof args.shopDomainFromPayload === "string"
      ? args.shopDomainFromPayload
      : null);
  if (!shopDomain) {
    return { status: 400, body: { error: "Missing shop domain" } };
  }

  const shopId = await resolveShopIdByDomain(shopDomain);
  if (!shopId) {
    // Unknown shop — 200 so Shopify stops retrying. FK would reject any
    // webhook_events claim, so don't even attempt it.
    return { status: 200, body: { ok: true, skipped: "unknown_shop" } };
  }

  const adminGid =
    typeof payload?.["admin_graphql_api_id"] === "string"
      ? (payload?.["admin_graphql_api_id"] as string)
      : null;
  const numericId = payload?.["id"];
  const shopifyObjectId =
    adminGid ??
    (typeof numericId === "string" || typeof numericId === "number"
      ? String(numericId)
      : null);

  if (!shopifyObjectId) {
    return { status: 200, body: { ok: true, skipped: "missing_order_id" } };
  }

  const eventId =
    headers.webhookId ??
    // Stable fallback when Shopify omits the header (test deliveries
    // from the partner dashboard sometimes do).
    `fallback:${topic}:${shopifyObjectId}:${started}`;

  const excerpt = buildSafePayloadExcerpt(payload);

  let eventRowId: string | null = null;
  try {
    const claim = await checkAndClaim({
      shopId,
      eventId,
      topic,
      shopifyObjectId,
      payloadExcerpt: excerpt,
    });
    if (claim.status === "duplicate") {
      return {
        status: 200,
        body: { ok: true, skipped: "duplicate_event" },
      };
    }
    eventRowId = claim.eventRowId;
  } catch (err) {
    return {
      status: 500,
      body: {
        error: "webhook_claim_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const finalize = async (
    outcome: WebhookOutcome,
    errorMessage: string | null = null,
  ): Promise<void> => {
    if (!eventRowId) return;
    await markProcessed({
      eventRowId,
      outcome,
      processingMs: Date.now() - started,
      errorMessage,
    });
  };

  // Derive the order GID. The payload may carry either the numeric id
  // or the admin_graphql_api_id; the GraphQL fetch needs the GID form.
  const orderGid = adminGid ?? `gid://shopify/Order/${shopifyObjectId}`;

  // LSE-4 session→order match-back. The storefront pixel stores the token
  // from Shopify's `checkout_started` event into `checkout_sessions.
  // cart_token` — but that value is the order's **checkout_token**, NOT its
  // cart_token (verified 2026-07-04: 44/95 sessions match orders on
  // checkout_token, 0 on cart_token; the two are different Shopify
  // identifier namespaces). So we join the REST payload's `checkout_token`
  // against the stored session key. `cart_token` is kept as a fallback for
  // any pixel variant that captured the true cart token. Admin GraphQL
  // dropped both fields in 2026-01, so the REST payload is the only source.
  // Best-effort + non-fatal: a miss or error never blocks order ingest.
  // Runs before the ingest-outcome branches so a re-fired webhook that
  // returns `skipped_unchanged` still performs the link.
  const sessionKey =
    (typeof payload?.["checkout_token"] === "string"
      ? (payload["checkout_token"] as string)
      : null) ??
    (typeof payload?.["cart_token"] === "string"
      ? (payload["cart_token"] as string)
      : null);
  if (sessionKey) {
    const orderPlacedAt =
      (typeof payload?.["processed_at"] === "string" && payload["processed_at"]) ||
      (typeof payload?.["created_at"] === "string" && payload["created_at"]) ||
      new Date().toISOString();
    try {
      // Store the numeric order id so the disputed-order read side
      // (which only has the GID) can match after normalizing.
      const numericOrderId = /(\d+)\s*$/.exec(shopifyObjectId)?.[1] ?? shopifyObjectId;
      await matchSessionToOrder({
        shopId,
        cartToken: sessionKey,
        shopifyOrderId: numericOrderId,
        orderPlacedAt: orderPlacedAt as string,
      });
    } catch (err) {
      console.warn(
        `[handleOrderWebhook] session match-back failed for order ${shopifyObjectId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  try {
    const result = await normalizeOrderIngest(shopId, orderGid, {
      correlationId: `webhook-${topic}-${eventId}`,
    });

    if (result.status === "skipped_unknown_order") {
      // Shopify returned null — order was deleted between webhook fire
      // and our GraphQL fetch. Not retriable.
      await finalize("skipped_unchanged", "order_not_found");
      return {
        status: 200,
        body: { ok: true, outcome: "skipped_unknown_order" },
      };
    }

    if (result.status === "skipped_unchanged") {
      await finalize("skipped_unchanged");
      return {
        status: 200,
        body: {
          ok: true,
          outcome: "skipped_unchanged",
          persist: result.persistResult ?? null,
        },
      };
    }

    await finalize("applied");
    return {
      status: 200,
      body: {
        ok: true,
        outcome: "applied",
        persist: result.persistResult ?? null,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalize("error", msg);
    // 500 → Shopify retries; the hash dedup gate makes the retry safe.
    return {
      status: 500,
      body: { error: "processing_failed", message: msg },
    };
  }
}

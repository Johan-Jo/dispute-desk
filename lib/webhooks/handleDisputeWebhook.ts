/**
 * Shared direct-processing pipeline for disputes/create + disputes/update.
 *
 * Pipeline order (each step short-circuits on failure):
 *   1. Verify HMAC.
 *   2. Resolve shop by domain (header preferred — header is signed, body isn't).
 *      Unknown shop → 200 + skipped:"unknown_shop" so Shopify does not retry.
 *   3. Layer A delivery dedup: claim the (shop_id, X-Shopify-Webhook-Id) row
 *      in webhook_events. Duplicate → 200 + skipped:"duplicate_event".
 *   4. Normalize the REST payload into a DisputeSnapshot. Strict Zod —
 *      malformed → 200 + outcome:"error_schema_validation" so Shopify stops
 *      retrying and the hourly cron picks it up.
 *   5. applyDisputeSnapshot → upsert + dispute_events + monotonic guards.
 *   6. dispatchDisputeEffects → pipeline / email under Layer B effect dedup.
 *   7. Mark the webhook_events row processed with outcome + latency.
 *
 * Returns 200 in almost every case — webhooks are not the place to ask
 * Shopify for retries. The exception is step (1) failures (401) and
 * unexpected exceptions in steps 5+ (500, which Shopify retries safely
 * because all downstream effects are idempotent).
 */

import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";
import {
  checkAndClaim,
  markProcessed,
  buildSafePayloadExcerpt,
  type WebhookOutcome,
} from "@/lib/webhooks/eventIdempotency";
import {
  normalizeDisputeWebhookPayload,
  type DisputeSnapshot,
} from "@/lib/disputes/disputeSnapshot";
import { applyDisputeSnapshot } from "@/lib/disputes/applyDisputeSnapshot";
import { dispatchDisputeEffects } from "@/lib/disputes/disputeEffectsDispatcher";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  DISPUTE_DETAIL_QUERY,
  type DisputeDetailResponse,
} from "@/lib/shopify/queries/disputes";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";

export interface DisputeWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

export interface DisputeWebhookHeaders {
  hmac: string | null;
  shopDomain: string | null;
  webhookId: string | null;
  topic: string;
}

export interface HandleDisputeWebhookArgs {
  rawBody: string;
  headers: DisputeWebhookHeaders;
  /** Best-effort shop fallback parsed from the body when the header is absent. */
  shopDomainFromPayload?: string | null;
}

export async function handleDisputeWebhook(
  args: HandleDisputeWebhookArgs,
): Promise<DisputeWebhookResult> {
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

  const db = getServiceClient();
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (!shop) {
    // Don't have the shop — don't claim a webhook_events row either
    // (FK would reject it). Return 200 so Shopify does not retry.
    return {
      status: 200,
      body: { ok: true, skipped: "unknown_shop" },
    };
  }

  // Pull a stable id from the payload for the audit excerpt + the
  // webhook_events.shopify_object_id index. Used by /admin/webhooks to link
  // a delivery row to the dispute.
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

  const eventId =
    headers.webhookId ??
    // Fallback when Shopify omits the header (unlikely in production but
    // possible in test deliveries from the partner dashboard).
    `fallback:${topic}:${shopifyObjectId ?? "?"}:${started}`;

  const excerpt = buildSafePayloadExcerpt(payload);

  let eventRowId: string | null = null;
  try {
    const claim = await checkAndClaim({
      shopId: shop.id,
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
    // Couldn't even claim the row — surface 500 so Shopify retries.
    return {
      status: 500,
      body: {
        error: "webhook_claim_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const finalizeOutcome = async (
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

  const snapshot = normalizeDisputeWebhookPayload(payload);
  if (!snapshot) {
    await finalizeOutcome("error_schema_validation");
    return {
      status: 200,
      body: { ok: true, skipped: "schema_validation_failed" },
    };
  }

  try {
    const result = await applyDisputeSnapshot({
      shopId: shop.id,
      source: "webhook",
      snapshot,
      fetchDisputeDetail: makeFetchDisputeDetail(shop.id, shopDomain),
    });

    if (result.outcome === "skipped_stale" || result.outcome === "skipped_monotonic_guard") {
      await finalizeOutcome(result.outcome);
      return {
        status: 200,
        body: { ok: true, outcome: result.outcome, warnings: result.guardWarnings },
      };
    }
    if (result.outcome === "skipped_unchanged") {
      await finalizeOutcome("skipped_unchanged");
      return {
        status: 200,
        body: { ok: true, outcome: "skipped_unchanged" },
      };
    }
    if (result.outcome === "error") {
      await finalizeOutcome(
        "error",
        result.guardWarnings.join("; ") || "apply_failed",
      );
      return {
        status: 500,
        body: { error: "apply_failed", warnings: result.guardWarnings },
      };
    }

    // outcome === "applied"
    await dispatchDisputeEffects({
      shopId: shop.id,
      result,
      source: "webhook",
    });

    await finalizeOutcome("applied");
    return {
      status: 200,
      body: {
        ok: true,
        outcome: "applied",
        disputeId: result.localDisputeId,
        events: result.events.map((e) => e.type),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finalizeOutcome("error", msg);
    // 500 → Shopify retries; idempotency layers make it safe.
    return {
      status: 500,
      body: { error: "processing_failed", message: msg },
    };
  }
}

/**
 * Build a fetchDisputeDetail closure for applyDisputeSnapshot. Resolves the
 * shop's offline access token, fetches `dispute(id:)` via GraphQL, and
 * returns the fields the REST webhook payload doesn't carry:
 *   - disputeEvidenceGid (the ShopifyPaymentsDisputeEvidence sub-object)
 *   - orderGid + orderName (the GraphQL order node)
 *
 * Used only on new-dispute inserts (existing-row updates skip the call).
 * Failures are non-fatal — the diff engine records a guardWarning and
 * proceeds; the hourly cron path patches the row later.
 */
function makeFetchDisputeDetail(
  shopId: string,
  shopDomain: string,
): (gid: string) => Promise<Partial<DisputeSnapshot> | null> {
  return async (disputeGid: string) => {
    const db = getServiceClient();
    const { data: session } = await db
      .from("shop_sessions")
      .select("access_token_encrypted")
      .eq("shop_id", shopId)
      .eq("session_type", "offline")
      .is("user_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!session?.access_token_encrypted) return null;

    let accessToken: string;
    try {
      const payload = deserializeEncrypted(session.access_token_encrypted);
      accessToken = decrypt(payload);
    } catch {
      accessToken = session.access_token_encrypted;
    }

    const gql = await requestShopifyGraphQL<DisputeDetailResponse>({
      session: { shopDomain, accessToken },
      query: DISPUTE_DETAIL_QUERY,
      variables: { id: disputeGid },
    });
    const dispute = gql.data?.dispute;
    if (!dispute) {
      console.warn(
        "[webhook-backfill] dispute(id:) returned null",
        { disputeGid, hasErrors: !!gql.errors, errors: gql.errors },
      );
      return null;
    }

    const result = {
      disputeEvidenceGid: dispute.disputeEvidence?.id ?? null,
      orderGid: dispute.order?.id ?? null,
      orderName: dispute.order?.name ?? null,
    };
    console.log(
      "[webhook-backfill] dispute(id:) response → snapshot patch",
      {
        disputeGid,
        orderPresent: !!dispute.order,
        orderIdRaw: dispute.order?.id,
        orderNameRaw: dispute.order?.name,
        disputeEvidenceIdRaw: dispute.disputeEvidence?.id,
        result,
      },
    );
    return result;
  };
}

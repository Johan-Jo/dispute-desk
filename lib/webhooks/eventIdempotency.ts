/**
 * Layer A delivery idempotency for Shopify webhooks.
 *
 * Each incoming dispute webhook is claimed by (shop_id, X-Shopify-Webhook-Id).
 * Shopify guarantees the webhook-id is stable across retries, so a retried
 * delivery collides on the unique constraint and is treated as a duplicate.
 *
 * Layer B (effect-level) idempotency is enforced separately in
 * `lib/disputes/dispatchOnce.ts` via audit_events.dispute_event_key.
 *
 * Raw webhook bodies are NEVER stored anywhere; only the structured allowlist
 * excerpt built by `buildSafePayloadExcerpt`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";

export type WebhookOutcome =
  | "applied"
  | "skipped_unchanged"
  | "duplicate_event"
  | "error"
  | "error_schema_validation"
  | "skipped_unknown_shop"
  | "skipped_stale"
  | "skipped_monotonic_guard";

export interface CheckAndClaimArgs {
  shopId: string | null;
  eventId: string;
  topic: string;
  shopifyObjectId?: string | null;
  payloadExcerpt?: Record<string, unknown> | null;
  client?: SupabaseClient;
}

export interface CheckAndClaimResult {
  status: "fresh" | "duplicate";
  /** Row id for the freshly inserted webhook_events row. Null when duplicate. */
  eventRowId: string | null;
}

export interface MarkProcessedArgs {
  eventRowId: string;
  outcome: WebhookOutcome;
  processingMs: number;
  errorMessage?: string | null;
  client?: SupabaseClient;
}

/**
 * Atomically claim a webhook event. Returns "fresh" on first delivery and
 * "duplicate" when the (shop_id, event_id) pair has already been seen.
 *
 * Implementation note: relies on the `webhook_events_event_id_unique`
 * constraint. The unique-violation Postgres error code is `23505`.
 */
export async function checkAndClaim(
  args: CheckAndClaimArgs,
): Promise<CheckAndClaimResult> {
  const sb = args.client ?? getServiceClient();

  const { data, error } = await sb
    .from("webhook_events")
    .insert({
      shop_id: args.shopId,
      event_id: args.eventId,
      topic: args.topic,
      shopify_object_id: args.shopifyObjectId ?? null,
      payload_excerpt: args.payloadExcerpt ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Postgres unique_violation. supabase-js surfaces it on `error.code`.
    if ((error as { code?: string }).code === "23505") {
      return { status: "duplicate", eventRowId: null };
    }
    throw new Error(
      `webhook_events insert failed: ${error.message ?? String(error)}`,
    );
  }

  if (!data?.id) {
    throw new Error("webhook_events insert returned no id");
  }

  return { status: "fresh", eventRowId: data.id };
}

export async function markProcessed(args: MarkProcessedArgs): Promise<void> {
  const sb = args.client ?? getServiceClient();
  const { error } = await sb
    .from("webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      outcome: args.outcome,
      processing_ms: args.processingMs,
      error_message: args.errorMessage ?? null,
    })
    .eq("id", args.eventRowId);

  if (error) {
    // Don't throw: a missing processed_at update is recoverable and we don't
    // want to mask the underlying webhook outcome. Log loudly so the
    // /admin/webhooks panel surfaces the orphan via "received without
    // processed_at" follow-up queries.
    console.error(
      "[webhook_events] markProcessed failed",
      args.eventRowId,
      error.message,
    );
  }
}

/**
 * Build a structured excerpt of a dispute webhook payload using an explicit
 * allowlist. Unknown fields are dropped silently.
 *
 * Allowlist additions require security review — payload_excerpt is the only
 * place the webhook payload is persisted, and the table has no PII allowance.
 */
const ALLOWLISTED_PAYLOAD_FIELDS = [
  "id",
  "admin_graphql_api_id",
  "status",
  "reason",
  "network_reason_code",
  "initiated_at",
  "evidence_due_by",
  "evidence_sent_on",
  "finalized_on",
  "amount",
  "currency",
  "type",
  "order_id",
  "order_admin_graphql_api_id",
] as const;

export function buildSafePayloadExcerpt(
  rawPayload: unknown,
): Record<string, unknown> | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const raw = rawPayload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWLISTED_PAYLOAD_FIELDS) {
    if (key in raw) {
      const value = raw[key];
      // Drop nested objects defensively — the allowlisted fields are all
      // scalars in the Shopify dispute payload. If Shopify changes the shape
      // we'd rather drop than silently widen.
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        out[key] = value;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Exposed for tests. */
export const __ALLOWLISTED_PAYLOAD_FIELDS = ALLOWLISTED_PAYLOAD_FIELDS;

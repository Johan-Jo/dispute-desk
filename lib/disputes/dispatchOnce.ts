/**
 * withEffectDedup — Layer B effect idempotency primitive.
 *
 * The dispatcher uses this to fire each downstream effect (build_pack
 * enqueue, email send, audit log) AT MOST ONCE, even when both the cron and
 * the webhook observe the same Shopify state change.
 *
 * Mechanism: claim by inserting an audit_events row carrying
 * `dispute_event_key`. The unique index
 * `audit_events_dispute_event_key_unique` makes the second observer's
 * insert fail with code 23505; we treat that as "already_applied" and skip
 * the effect.
 *
 * If the effect itself throws after the claim succeeds, the audit row stays
 * (audit_events is append-only by trigger). The claim is what enforces
 * "at most once" — the effect itself is fire-and-forget from the
 * dispatcher's perspective. Effects that need transactional retry should
 * handle that internally.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";

export interface WithEffectDedupArgs<T> {
  shopId: string;
  disputeId: string;
  eventKey: string;
  effectName: string;
  /**
   * Additional payload merged into audit_events.event_payload alongside the
   * canonical `effect_name` / `event_key` keys. Use for breadcrumb context
   * (status pair, outcome, etc.). Must be JSON-serializable.
   */
  context?: Record<string, unknown>;
  effect: () => Promise<T>;
  client?: SupabaseClient;
}

export type WithEffectDedupResult<T> =
  | { ran: true; result: T }
  | { ran: false; reason: "already_applied" | "claim_failed"; error?: string };

export async function withEffectDedup<T>(
  args: WithEffectDedupArgs<T>,
): Promise<WithEffectDedupResult<T>> {
  const sb = args.client ?? getServiceClient();

  const { error: claimErr } = await sb.from("audit_events").insert({
    shop_id: args.shopId,
    dispute_id: args.disputeId,
    actor_type: "system",
    event_type: `effect:${args.effectName}`,
    dispute_event_key: args.eventKey,
    event_payload: {
      effect_name: args.effectName,
      event_key: args.eventKey,
      ...(args.context ?? {}),
    },
  });

  if (claimErr) {
    if ((claimErr as { code?: string }).code === "23505") {
      return { ran: false, reason: "already_applied" };
    }
    return {
      ran: false,
      reason: "claim_failed",
      error: claimErr.message,
    };
  }

  const result = await args.effect();
  return { ran: true, result };
}

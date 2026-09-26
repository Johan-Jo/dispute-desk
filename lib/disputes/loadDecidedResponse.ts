/**
 * Gathers the inputs `resolveDecidedResponse` and the decided view need for
 * one decided dispute.
 *
 * Shared by the workspace API (Overview) and the outcome email, so both read
 * the same rows. Failure-tolerant: returns null on any read error, and callers
 * then render nothing rather than a guess.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DECIDED_AUDIT_EVENT_TYPES,
  resolveDecidedResponse,
  type DecidedAuditEvent,
  type DecidedResponse,
} from "@/lib/disputes/decidedResponse";

export interface DecidedDisputeRow {
  id: string;
  shop_id: string;
  closed_at: string | null;
  due_at: string | null;
  /** Shopify's `evidenceSentOn` (see syncDisputes.ts). */
  submitted_at: string | null;
  evidence_saved_to_shopify_at: string | null;
  review_state: string | null;
  /** Needed only for the decided view's order facts. */
  order_gid?: string | null;
}

export interface DecidedOrderFacts {
  createdAt: string | null;
  fulfillmentStatus: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  riskRecommendation: string | null;
}

export interface DecidedContext {
  response: DecidedResponse;
  events: DecidedAuditEvent[];
  firstPackAt: string | null;
  order: DecidedOrderFacts | null;
}

function earliest(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestT = Infinity;
  for (const v of values) {
    if (!v) continue;
    const t = Date.parse(v);
    if (Number.isFinite(t) && t < bestT) {
      best = v;
      bestT = t;
    }
  }
  return best;
}

export async function loadDecidedContext(
  sb: SupabaseClient,
  row: DecidedDisputeRow,
  opts: { withOrder?: boolean } = {},
): Promise<DecidedContext | null> {
  try {
    const [shopRes, packsRes, pkgRes, eventsRes, orderRes] = await Promise.all([
      sb.from("shops").select("created_at, installed_at").eq("id", row.shop_id).maybeSingle(),
      sb.from("evidence_packs").select("saved_to_shopify_at, created_at").eq("dispute_id", row.id),
      sb
        .from("defence_packages")
        .select("submitted_at")
        .eq("dispute_id", row.id)
        .eq("status", "submitted"),
      sb
        .from("audit_events")
        .select("event_type, event_payload, created_at")
        .eq("dispute_id", row.id)
        .in("event_type", [...DECIDED_AUDIT_EVENT_TYPES])
        .order("created_at", { ascending: true }),
      opts.withOrder && row.order_gid
        ? sb
            .from("shopify_orders")
            .select(
              "created_at_shopify, fulfillment_status, fulfilled_at, cancelled_at, risk_recommendation_initial",
            )
            .eq("shop_id", row.shop_id)
            .eq("shopify_order_id", row.order_gid)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (shopRes.error || packsRes.error || pkgRes.error || eventsRes.error) return null;

    const shop = shopRes.data as { created_at?: string | null; installed_at?: string | null } | null;
    // `installed_at` moves forward on a reinstall; `created_at` is the first
    // install. The earlier of the two is when DisputeDesk first saw the shop.
    const installedAt = earliest([shop?.created_at, shop?.installed_at]);

    const packs = (packsRes.data ?? []) as Array<{
      saved_to_shopify_at: string | null;
      created_at: string | null;
    }>;
    const pkgs = (pkgRes.data ?? []) as Array<{ submitted_at: string | null }>;
    const weFiledAt = earliest([
      row.evidence_saved_to_shopify_at,
      ...packs.map((p) => p.saved_to_shopify_at),
      ...pkgs.map((p) => p.submitted_at),
    ]);
    const events = (eventsRes.data ?? []) as DecidedAuditEvent[];

    const response = resolveDecidedResponse({
      closedAt: row.closed_at,
      dueAt: row.due_at,
      evidenceSentOn: row.submitted_at,
      installedAt,
      weFiledAt,
      hasPack: packs.length > 0,
      reviewState: row.review_state,
      events,
    });

    // An order read failure costs only the order facts, never the answer.
    const o = orderRes.error
      ? null
      : (orderRes.data as {
          created_at_shopify?: string | null;
          fulfillment_status?: string | null;
          fulfilled_at?: string | null;
          cancelled_at?: string | null;
          risk_recommendation_initial?: string | null;
        } | null);

    return {
      response,
      events,
      firstPackAt: earliest(packs.map((p) => p.created_at)),
      order: o
        ? {
            createdAt: o.created_at_shopify ?? null,
            fulfillmentStatus: o.fulfillment_status ?? null,
            fulfilledAt: o.fulfilled_at ?? null,
            cancelledAt: o.cancelled_at ?? null,
            riskRecommendation: o.risk_recommendation_initial ?? null,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export async function loadDecidedResponse(
  sb: SupabaseClient,
  row: DecidedDisputeRow,
): Promise<DecidedResponse | null> {
  return (await loadDecidedContext(sb, row))?.response ?? null;
}

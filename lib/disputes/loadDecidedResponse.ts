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
import type { DecidedViewInputs } from "@/lib/disputes/decidedView";
import { resolveReasonFamily } from "@/lib/argument/reasonFamily";
import { computeStorePatterns, type StorePatternRow, type StorePatterns } from "@/lib/disputes/storePatterns";

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

/** The dispute columns `loadDecidedViewInputs` reads. */
export interface DecidedViewDisputeRow extends DecidedDisputeRow {
  normalized_status: string | null;
  phase: string | null;
  reason: string | null;
  amount: number | string | null;
  currency_code: string | null;
  initiated_at: string | null;
  outcome_amount_lost?: number | string | null;
  outcome_amount_recovered?: number | string | null;
}

export const DECIDED_VIEW_DISPUTE_COLUMNS =
  "id, shop_id, order_gid, normalized_status, phase, reason, amount, currency_code, initiated_at, due_at, closed_at, submitted_at, evidence_saved_to_shopify_at, review_state, outcome_amount_lost, outcome_amount_recovered";

/**
 * Everything `buildDecidedView` needs, from the database. ONE assembly for the
 * Overview (workspace API) and the outcome email, so the page and the email
 * describe a decided case from the same rows. Null when the dispute is not
 * decided or a read fails.
 */
export async function loadDecidedViewInputs(
  sb: SupabaseClient,
  row: DecidedViewDisputeRow,
): Promise<DecidedViewInputs | null> {
  const outcome =
    row.normalized_status === "won" || row.normalized_status === "lost" ? row.normalized_status : null;
  if (!outcome) return null;
  try {
    const phase = row.phase === "inquiry" ? "inquiry" : "chargeback";
    const [ctx, packRes, storePatterns] = await Promise.all([
      loadDecidedContext(sb, row, { withOrder: true }),
      sb
        .from("evidence_packs")
        .select("id, pack_json")
        .eq("dispute_id", row.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadStorePatterns(sb, row.shop_id, { reason: row.reason ?? null, phase }),
    ]);
    if (!ctx || packRes.error) return null;
    const pack = packRes.data as { id: string; pack_json: unknown } | null;

    // Evidence items by field — first write wins, as the workspace route and
    // collectors do. The merchant-side record, including facts withheld from
    // the issuer.
    const facts: Record<string, Record<string, unknown>> = {};
    if (pack) {
      const { data: items, error } = await sb
        .from("evidence_items")
        .select("payload")
        .eq("pack_id", pack.id)
        .order("created_at", { ascending: true });
      if (error) return null;
      for (const it of (items ?? []) as Array<{ payload: Record<string, unknown> | null }>) {
        const payload = it.payload;
        const fields = (payload?.fieldsProvided as string[] | undefined) ?? [];
        for (const f of fields) if (payload && !facts[f]) facts[f] = payload;
      }
    }
    const rawItems = Array.isArray(facts.order_confirmation?.lineItems)
      ? (facts.order_confirmation.lineItems as Array<{ title?: unknown; quantity?: unknown }>)
      : [];
    const fatal = (pack?.pack_json as { fatal_loss?: { reason?: string | null } } | null)?.fatal_loss;
    const amount = Number(
      (outcome === "lost" ? row.outcome_amount_lost : row.outcome_amount_recovered) ?? row.amount ?? 0,
    );

    return {
      outcome,
      phase,
      reason: row.reason ?? null,
      amount: Number.isFinite(amount) ? amount : 0,
      currency: row.currency_code ?? "USD",
      openedAt: row.initiated_at ?? null,
      dueAt: row.due_at ?? null,
      closedAt: row.closed_at ?? null,
      response: ctx.response,
      order: ctx.order,
      lineItems: rawItems
        .filter((i) => typeof i.title === "string" && i.title.length > 0)
        .map((i) => ({ title: i.title as string, quantity: Number(i.quantity ?? 1) })),
      facts,
      fatalLossReason: fatal?.reason ?? null,
      firstPackAt: ctx.firstPackAt,
      events: ctx.events,
      storePatterns,
    };
  } catch {
    return null;
  }
}

const PAGE = 1000; // PostgREST caps an un-ranged select at 1000 rows.
const ORDER_CHUNK = 100;

/**
 * The shop's decided disputes of the current type and phase, with the linked
 * order's shipping and risk columns — the rows `computeStorePatterns` reads.
 * Null on any read failure: the view then shows no store numbers, never a
 * number built from a partial read.
 */
export async function loadStorePatterns(
  sb: SupabaseClient,
  shopId: string,
  current: { reason: string | null; phase: "inquiry" | "chargeback" },
): Promise<StorePatterns | null> {
  try {
    const family = resolveReasonFamily(current.reason);
    const disputes: Array<{
      reason: string | null;
      phase: string | null;
      normalized_status: string;
      initiated_at: string | null;
      order_gid: string | null;
    }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("disputes")
        .select("reason, phase, normalized_status, initiated_at, order_gid")
        .eq("shop_id", shopId)
        .in("normalized_status", ["won", "lost"])
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return null;
      disputes.push(...((data ?? []) as typeof disputes));
      if (!data || data.length < PAGE) break;
    }
    const same = disputes.filter(
      (d) =>
        (d.phase === "inquiry" ? "inquiry" : "chargeback") === current.phase &&
        resolveReasonFamily(d.reason) === family,
    );

    // Orders only for the lost rows — the patterns never read a win.
    const gids = [...new Set(same.filter((d) => d.normalized_status === "lost" && d.order_gid).map((d) => d.order_gid as string))];
    const orders = new Map<string, StorePatternRow["order"]>();
    for (let i = 0; i < gids.length; i += ORDER_CHUNK) {
      const { data, error } = await sb
        .from("shopify_orders")
        .select("shopify_order_id, fulfillment_status, fulfilled_at, risk_recommendation_initial")
        .eq("shop_id", shopId)
        .in("shopify_order_id", gids.slice(i, i + ORDER_CHUNK));
      if (error) return null;
      for (const o of (data ?? []) as Array<{
        shopify_order_id: string;
        fulfillment_status: string | null;
        fulfilled_at: string | null;
        risk_recommendation_initial: string | null;
      }>) {
        orders.set(o.shopify_order_id, {
          fulfillmentStatus: o.fulfillment_status,
          fulfilledAt: o.fulfilled_at,
          riskRecommendation: o.risk_recommendation_initial,
        });
      }
    }

    return computeStorePatterns(
      same.map((d) => ({
        reason: d.reason,
        phase: current.phase,
        outcome: d.normalized_status === "won" ? "won" : "lost",
        openedAt: d.initiated_at,
        order: d.order_gid ? orders.get(d.order_gid) ?? null : null,
      })),
      current,
    );
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

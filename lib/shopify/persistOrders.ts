/**
 * Shared writer for `shopify_orders` + `shopify_order_risk_assessments`.
 *
 * Extracted from `lib/disputes/backfillOrders.ts` so the orders/* webhook
 * ingest path (PR-A) and the daily reconciliation cron (PR-B) reuse the
 * same insert/update partition logic + risk-payload dedup.
 *
 * Architectural contracts:
 *   1. `shopify_orders.risk_*_initial` columns are immutable after first
 *      ingest (enforced by the DB trigger). The writer NEVER attempts to
 *      update them — only the initial INSERT carries those values. The
 *      UPDATE branch sets mutable columns only.
 *   2. `shopify_order_risk_assessments` is append-only, gated by
 *      `risk_payload_hash`. A new row is appended only when the canonical
 *      payload hash differs from the most-recent stored hash for
 *      (shop, order). Without this guard, every orders/updated webhook
 *      (fulfillment, tag, note edits) would inflate history.
 *   3. The writer is service-role only — both tables are RLS-locked.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type {
  ShopifyOrderRow,
  ShopifyOrderRiskAssessmentRow,
} from "@/lib/shopify/queries/ordersForBackfill";

export interface PersistOrdersResult {
  ordersInserted: number;
  ordersUpdated: number;
  assessmentsInserted: number;
  assessmentsSkippedUnchanged: number;
}

/**
 * Persist a batch of normalized orders + their per-assessment rows.
 *
 * `risk_payload_hash` MUST be populated on each assessment row by the
 * caller (use `lib/fraudIntel/riskPayloadHash.computeRiskPayloadHash`).
 * Rows whose hash matches the latest stored hash for the same
 * (shop, order) are dropped — that's the load-bearing dedup gate.
 */
export async function persistOrders(
  shopId: string,
  orders: ShopifyOrderRow[],
  assessments: ShopifyOrderRiskAssessmentRow[],
): Promise<PersistOrdersResult> {
  const result: PersistOrdersResult = {
    ordersInserted: 0,
    ordersUpdated: 0,
    assessmentsInserted: 0,
    assessmentsSkippedUnchanged: 0,
  };
  if (orders.length === 0 && assessments.length === 0) return result;

  const sb = getServiceClient();

  // ── Partition orders into inserts vs updates ─────────────────────
  const ids = orders.map((o) => o.shopify_order_id);
  let existingSet = new Set<string>();
  if (ids.length > 0) {
    const { data: existing, error } = await sb
      .from("shopify_orders")
      .select("shopify_order_id")
      .eq("shop_id", shopId)
      .in("shopify_order_id", ids);
    if (error) {
      throw new Error(
        `shopify_orders existence lookup failed: ${error.message}`,
      );
    }
    existingSet = new Set((existing ?? []).map((r) => r.shopify_order_id));
  }

  const inserts = orders.filter((o) => !existingSet.has(o.shopify_order_id));
  const updates = orders.filter((o) => existingSet.has(o.shopify_order_id));

  if (inserts.length > 0) {
    const { error } = await sb.from("shopify_orders").insert(inserts);
    if (error) {
      throw new Error(`shopify_orders insert failed: ${error.message}`);
    }
    result.ordersInserted = inserts.length;
  }

  // Mutable-column write for existing rows, as ONE batched upsert.
  //
  // This used to be a `for (const o of updates)` loop issuing one
  // round-trip per order. That is invisible on a first-time historical
  // import (every row is an INSERT, which takes the batched path above)
  // and pathological on a re-ingest, where every row is an UPDATE:
  // measured at ~476 ms/order — 47.6 s for a 100-order page against
  // 2.6 s to fetch the same page from Shopify (prod, 2026-08-30).
  // A backfill/repair is exactly the all-UPDATE case.
  //
  // `risk_*_initial` stays out of the payload, upholding contract 1 in
  // the module header: this writer never asserts those columns after the
  // first insert. Because they are omitted, `onConflict` leaves the
  // stored values untouched and the
  // `shopify_orders_lock_initial_risk` trigger sees no change. (The
  // trigger only raises when the new value `is distinct from` the old,
  // so even re-sending identical values would pass — but omitting them
  // keeps the contract true by construction rather than by luck.)
  //
  // `id` is likewise omitted: these rows already exist, and the conflict
  // target resolves them by (shop_id, shopify_order_id).
  //
  // `created_at_shopify`, `currency` and `order_total` ARE carried even
  // though they are immutable in practice. They are NOT NULL with no
  // default, and an upsert whose conflict target misses would INSERT —
  // which happens if a row is deleted between the existence lookup above
  // and this write (retention cleanup, a concurrent reconcile). Carrying
  // them makes that path insert a valid row instead of throwing a
  // not-null violation. They re-assert their own values on the normal
  // update path, which is a no-op.
  const nowIso = new Date().toISOString();
  if (updates.length > 0) {
    const { error } = await sb.from("shopify_orders").upsert(
      updates.map((o) => ({
        shop_id: shopId,
        shopify_order_id: o.shopify_order_id,
        created_at_shopify: o.created_at_shopify,
        currency: o.currency,
        order_total: o.order_total,
        processed_at: o.processed_at,
        cancelled_at: o.cancelled_at,
        fulfilled_at: o.fulfilled_at,
        country: o.country,
        is_cross_border: o.is_cross_border,
        payment_gateway: o.payment_gateway,
        payment_method: o.payment_method,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        cancel_reason: o.cancel_reason,
        fraud_protection_level: o.fraud_protection_level,
        three_ds_authenticated: o.three_ds_authenticated,
        delivery_status: o.delivery_status,
        delivered_at_tracking: o.delivered_at_tracking,
        signed_by_name: o.signed_by_name,
        tracking_source: o.tracking_source,
        updated_at: nowIso,
      })),
      { onConflict: "shop_id,shopify_order_id" },
    );
    if (error) {
      throw new Error(`shopify_orders update failed: ${error.message}`);
    }
    result.ordersUpdated = updates.length;
  }

  // ── Risk assessments: hash-gated append ──────────────────────────
  if (assessments.length === 0) return result;

  // Group by order to look up the most-recent stored hash once per order.
  const byOrder = new Map<string, ShopifyOrderRiskAssessmentRow[]>();
  for (const a of assessments) {
    const list = byOrder.get(a.shopify_order_id) ?? [];
    list.push(a);
    byOrder.set(a.shopify_order_id, list);
  }

  const toInsert: ShopifyOrderRiskAssessmentRow[] = [];

  // Existing hashes for every order in the batch, in ONE query.
  // This was previously a per-order lookup inside the loop below — the
  // same N+1 shape as the orders update, and the second-largest cost on
  // a re-ingest. The result is grouped per order so the dedup decision
  // below is unchanged: an incoming hash is dropped only when it already
  // exists for *that same* (shop, order).
  const orderIdsWithHashes = [...byOrder.keys()];
  const existingByOrder = new Map<string, Set<string>>();
  if (orderIdsWithHashes.length > 0) {
    const { data: existingRows, error: hashErr } = await sb
      .from("shopify_order_risk_assessments")
      .select("shopify_order_id, risk_payload_hash")
      .eq("shop_id", shopId)
      .in("shopify_order_id", orderIdsWithHashes)
      .not("risk_payload_hash", "is", null);
    if (hashErr) {
      throw new Error(
        `shopify_order_risk_assessments hash lookup failed: ${hashErr.message}`,
      );
    }
    for (const r of existingRows ?? []) {
      const row = r as { shopify_order_id: string; risk_payload_hash: string };
      if (!row.risk_payload_hash) continue;
      const set = existingByOrder.get(row.shopify_order_id) ?? new Set<string>();
      set.add(row.risk_payload_hash);
      existingByOrder.set(row.shopify_order_id, set);
    }
  }

  for (const [shopifyOrderId, rows] of byOrder) {
    const incomingHashes = new Set(
      rows
        .map((r) => r.risk_payload_hash)
        .filter((h): h is string => typeof h === "string" && h.length > 0),
    );
    if (incomingHashes.size === 0) {
      // No hash on the incoming row(s) — degrade to legacy append
      // behavior (matches pre-PR-A semantics). Should only happen for
      // call sites that haven't been migrated yet.
      toInsert.push(...rows);
      continue;
    }

    const existingHashes =
      existingByOrder.get(shopifyOrderId) ?? new Set<string>();

    for (const row of rows) {
      const hash = row.risk_payload_hash;
      if (hash && existingHashes.has(hash)) {
        result.assessmentsSkippedUnchanged++;
      } else {
        toInsert.push(row);
        if (hash) existingHashes.add(hash);
      }
    }
  }

  if (toInsert.length > 0) {
    const { error } = await sb
      .from("shopify_order_risk_assessments")
      .insert(toInsert);
    if (error) {
      throw new Error(
        `shopify_order_risk_assessments insert failed: ${error.message}`,
      );
    }
    result.assessmentsInserted = toInsert.length;
  }

  return result;
}

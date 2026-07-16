/**
 * Orchestrator for the orders/* webhook ingest path (PR-A).
 *
 *   1. Resolve the shop's offline session.
 *   2. Fetch the order via GraphQL (the same wide projection used by
 *      backfill — see ORDER_FOR_INGEST_QUERY). Single normalizer, single
 *      source-of-truth shape. ~15 query points per webhook is negligible.
 *   3. Normalize via `normalizeBackfillOrder` (returns ShopifyOrderRow +
 *      ShopifyOrderRiskAssessmentRow[] with risk_payload_hash populated).
 *   4. Persist via the shared `persistOrders` writer — gated by the
 *      risk_payload_hash dedup so orders/updated webhooks for non-risk
 *      edits (fulfillment, tags, notes) don't inflate history.
 *
 * Outcome shape: webhook handler logs to audit_events / webhook_events
 * with one of `applied | skipped_unchanged | error`. The handler maps
 * the writer's counters to that outcome.
 *
 * Failure handling: thrown errors propagate to the webhook handler so
 * it can return 500 → Shopify retries (idempotent thanks to the hash
 * gate). Auth invalidation surfaces via `ShopifyAuthInvalidError`.
 */

import { getShopBackgroundSession } from "@/lib/shopify/sessions/getShopBackgroundSession";
import { fetchOrderForIngest } from "@/lib/shopify/queries/orderForIngest";
import {
  normalizeBackfillOrder,
  normalizeFulfillmentTrackings,
} from "@/lib/shopify/queries/ordersForBackfill";
import { persistOrders, type PersistOrdersResult } from "@/lib/shopify/persistOrders";
import { persistFulfillmentTrackings } from "@/lib/shopify/persistFulfillmentTrackings";
import { upsertSignalRow } from "@/lib/fraudIntel/signalWriter";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { getServiceClient } from "@/lib/supabase/server";

const SHOP_PRIMARY_COUNTRY_QUERY = /* GraphQL */ `
  query ShopPrimaryCountry {
    shop {
      billingAddress {
        countryCodeV2
      }
    }
  }
`;

export interface OrderIngestResult {
  status: "applied" | "skipped_unchanged" | "skipped_unknown_order";
  persistResult?: PersistOrdersResult;
}

/**
 * Fetch + normalize + persist a single Shopify order. Designed for the
 * orders/* webhook handlers (PR-A) and the reconciliation cron (PR-B).
 *
 * Returns:
 *   - `applied`             — at least one of orders/assessments was inserted/updated
 *   - `skipped_unchanged`   — order existed, no mutable column moved, no new risk hash
 *   - `skipped_unknown_order` — Shopify returned null (deleted between fire and fetch)
 */
export async function normalizeOrderIngest(
  shopId: string,
  orderGid: string,
  opts: { correlationId?: string } = {},
): Promise<OrderIngestResult> {
  const session = await getShopBackgroundSession(shopId);
  const accessSession = {
    shopDomain: session.shopDomain,
    accessToken: session.accessToken,
  };

  const raw = await fetchOrderForIngest(accessSession, orderGid, {
    correlationId: opts.correlationId,
  });
  if (!raw) {
    return { status: "skipped_unknown_order" };
  }

  const storeCountry = await fetchShopPrimaryCountry(
    accessSession,
    opts.correlationId,
  );

  const { order, assessments } = normalizeBackfillOrder(shopId, raw, {
    storeCountryCode: storeCountry,
  });

  const persistResult = await persistOrders(shopId, [order], assessments);

  // Carrier plan PR 1A: per-shipment tracking rows. Auxiliary — a
  // failure never breaks the ingest contract (mirrors the signal-row
  // handling below).
  try {
    await persistFulfillmentTrackings(
      normalizeFulfillmentTrackings(shopId, raw),
    );
  } catch (err) {
    console.warn(
      `[carriers] fulfillment-tracking upsert failed for ${raw.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // PR-D: always upsert the signal row — even on skipped_unchanged we
  // refresh the parser snapshot in case PARSER_VERSION bumped or a
  // schema field flipped. The row is keyed on (shop, order) so the
  // upsert is cheap.
  try {
    await upsertSignalRow({
      shopId,
      shopifyOrderId: raw.id,
      raw,
    });
  } catch (err) {
    // Signal-row failure must not break the ingest contract — the raw
    // facts_json is still captured on shopify_order_risk_assessments,
    // and the hydration script can backfill the signal row later.
    console.warn(
      `[fraudIntel] signal-row upsert failed for ${raw.id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const moved =
    persistResult.ordersInserted > 0 ||
    persistResult.ordersUpdated > 0 ||
    persistResult.assessmentsInserted > 0;

  return {
    status: moved ? "applied" : "skipped_unchanged",
    persistResult,
  };
}

async function fetchShopPrimaryCountry(
  session: { shopDomain: string; accessToken: string },
  correlationId?: string,
): Promise<string | null> {
  try {
    const resp = await requestShopifyGraphQL<{
      shop?: { billingAddress?: { countryCodeV2?: string | null } | null } | null;
    }>({
      session,
      query: SHOP_PRIMARY_COUNTRY_QUERY,
      correlationId: correlationId ?? "shop-primary-country",
      locale: "en",
    });
    return resp.data?.shop?.billingAddress?.countryCodeV2 ?? null;
  } catch {
    // Cross-border classification is best-effort. A failed country
    // lookup leaves `is_cross_border` null for the row.
    return null;
  }
}

/**
 * Service-role helper: resolve `shop_id` from `shop_domain`. Returns null
 * for unknown shops so webhook handlers can return 200 + skipped without
 * the FK rejection that would happen if they tried to claim a webhook
 * row for an unknown shop.
 */
export async function resolveShopIdByDomain(
  shopDomain: string,
): Promise<string | null> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  return data?.id ?? null;
}

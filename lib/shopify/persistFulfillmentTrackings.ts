/**
 * Writer for `shopify_fulfillment_trackings` — per-shipment tracking rows
 * (carrier-delivery plan PR 1A, docs/plans/carrier-delivery-verification.plan.md).
 *
 * Contracts:
 *   1. Upsert on (shop_id, shopify_fulfillment_id, tracking_key). The
 *      payload carries ONLY Shopify-sourced columns, so a re-ingest can
 *      never clobber the carrier-lookup cache columns
 *      (effective_tracking_id, last_carrier_lookup_*, adapter/
 *      classification versions) written by the adapter layer.
 *   2. Auxiliary data: callers treat a failure here as non-fatal — the
 *      shopify_orders ingest contract must not break because the
 *      per-shipment table hiccuped. Callers log-and-continue.
 *   3. Service-role only — the table is RLS-locked with no policies.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { ShopifyFulfillmentTrackingRow } from "@/lib/shopify/queries/ordersForBackfill";

export async function persistFulfillmentTrackings(
  rows: ShopifyFulfillmentTrackingRow[],
): Promise<{ upserted: number }> {
  if (rows.length === 0) return { upserted: 0 };

  const sb = getServiceClient();
  const { error } = await sb
    .from("shopify_fulfillment_trackings")
    .upsert(rows, {
      onConflict: "shop_id,shopify_fulfillment_id,tracking_key",
    });
  if (error) {
    throw new Error(
      `shopify_fulfillment_trackings upsert failed: ${error.message}`,
    );
  }
  return { upserted: rows.length };
}

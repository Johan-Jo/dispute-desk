/**
 * Carrier-lookup cache over `shopify_fulfillment_trackings` — plan §5.8.
 *
 * A cached TERMINAL carrier result is reused without a new API call; a
 * non-terminal or failed lookup is eligible for re-fetch on the next pack
 * build (covers §5.7 triggers 5 and 7). The cache writer touches ONLY the
 * adapter-owned columns plus row identity — Shopify-sourced columns stay
 * owned by the ingest path (and vice versa).
 *
 * Every function here is fail-soft: cache errors degrade to "no cache"
 * (an extra API call) or a warn log — never a pack-build failure.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { logCarrierEvent } from "@/lib/carriers/alerts";
import type { DeliverySignal } from "@/lib/carriers/reconcile";
import type {
  CarrierLookupStatus,
  CarrierMatch,
  NormalizedCarrierShipment,
  TrackingEntryInfo,
} from "@/lib/carriers/types";

/** Classifier semantics marker persisted with each cached result — lets a
 *  future rule change find rows that need reclassification. */
export const CLASSIFICATION_VERSION = "timeline@1";

export interface CachedLookup {
  tracking_key: string;
  shopify_fulfillment_id: string;
  shipment_status: string | null;
  terminal_at: string | null;
  tracking_source: string | null;
  last_carrier_lookup_result: string | null;
  last_carrier_lookup_at: string | null;
  effective_tracking_id: string | null;
}

const cacheKey = (fulfillmentId: string, trackingKey: string) =>
  `${fulfillmentId}|${trackingKey}`;

export function trackingKeyOf(entry: TrackingEntryInfo): string {
  return (entry.number ?? "").trim() || (entry.url ?? "").trim() || "";
}

/** Fetch cached lookups for a set of fulfillments in one query. Returns a
 *  map keyed on `${fulfillmentId}|${trackingKey}`. Failure → empty map. */
export async function getCachedLookups(
  shopId: string,
  fulfillmentIds: string[],
): Promise<Map<string, CachedLookup>> {
  const out = new Map<string, CachedLookup>();
  if (fulfillmentIds.length === 0) return out;
  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("shopify_fulfillment_trackings")
      .select(
        "tracking_key, shopify_fulfillment_id, shipment_status, terminal_at, tracking_source, last_carrier_lookup_result, last_carrier_lookup_at, effective_tracking_id",
      )
      .eq("shop_id", shopId)
      .in("shopify_fulfillment_id", fulfillmentIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as CachedLookup[]) {
      out.set(cacheKey(row.shopify_fulfillment_id, row.tracking_key), row);
    }
  } catch (err) {
    logCarrierEvent("cache_read_failed", {
      shopId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

/** Terminal cache hit = a prior successful carrier lookup that reached a
 *  terminal state. Reused without a new API call (plan §5.7 — terminal
 *  results are normally reused; retention handled separately). */
export function isTerminalCacheHit(row: CachedLookup | undefined): boolean {
  return (
    !!row &&
    row.last_carrier_lookup_result === "success" &&
    !!row.terminal_at &&
    !!row.shipment_status &&
    !!row.tracking_source?.startsWith("carrier_api")
  );
}

export function cachedSignal(row: CachedLookup): DeliverySignal | null {
  if (!row.shipment_status) return null;
  return {
    status: row.shipment_status as DeliverySignal["status"],
    at: row.terminal_at,
    source: row.tracking_source ?? "carrier_api",
  };
}

/** Persist a lookup attempt onto the shipment's row. Upsert keyed on
 *  (shop, fulfillment, tracking_key); adapter-owned columns only, plus
 *  row identity so a row not yet created by ingest still lands. The
 *  terminal columns (shipment_status/terminal_at/tracking_source) are
 *  written ONLY when the carrier signal won reconciliation — a stale or
 *  losing carrier result never overwrites a newer state. */
export async function persistCarrierLookup(args: {
  shopId: string;
  orderGid: string;
  fulfillmentId: string;
  entry: TrackingEntryInfo;
  match: CarrierMatch;
  adapterVersion: string;
  lookupStatus: CarrierLookupStatus;
  shipment?: NormalizedCarrierShipment;
  /** The carrier signal is the reconciled current state → write it. */
  carrierWon: boolean;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    shop_id: args.shopId,
    shopify_order_id: args.orderGid,
    shopify_fulfillment_id: args.fulfillmentId,
    tracking_key: trackingKeyOf(args.entry),
    company_raw: (args.entry.company ?? "").trim() || null,
    tracking_number: (args.entry.number ?? "").trim() || null,
    tracking_url: (args.entry.url ?? "").trim() || null,
    carrier_normalized: args.match.carrier,
    carrier_adapter: args.match.carrier,
    effective_tracking_id: args.match.trackingNumber,
    identifier_source: args.match.matchedFrom,
    last_carrier_lookup_at: nowIso,
    last_carrier_lookup_result: args.lookupStatus,
    adapter_version: args.adapterVersion,
    classification_version: CLASSIFICATION_VERSION,
    updated_at: nowIso,
  };
  if (args.carrierWon && args.shipment?.deliveryStatus) {
    row.shipment_status = args.shipment.deliveryStatus;
    row.terminal_at = args.shipment.terminalAt;
    row.tracking_source = `carrier_api_${args.match.carrier}`;
  }
  try {
    const sb = getServiceClient();
    const { error } = await sb
      .from("shopify_fulfillment_trackings")
      .upsert(row, { onConflict: "shop_id,shopify_fulfillment_id,tracking_key" });
    if (error) throw new Error(error.message);
  } catch (err) {
    logCarrierEvent("cache_write_failed", {
      shopId: args.shopId,
      fulfillmentId: args.fulfillmentId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Roll the reconciled carrier state up to `shopify_orders` so the
 *  Insights KPI / admin reuse it without another API call (plan §5.8).
 *  Called only when the carrier signal won reconciliation. */
export async function rollupOrderDelivery(args: {
  shopId: string;
  orderGid: string;
  signal: DeliverySignal;
  signedByName: string | null;
}): Promise<void> {
  try {
    const sb = getServiceClient();
    const update: Record<string, unknown> = {
      delivery_status: args.signal.status,
      delivered_at_tracking: args.signal.status === "Delivered" ? args.signal.at : null,
      tracking_source: args.signal.source,
      updated_at: new Date().toISOString(),
    };
    if (args.signedByName) update.signed_by_name = args.signedByName;
    const { error } = await sb
      .from("shopify_orders")
      .update(update)
      .eq("shop_id", args.shopId)
      .eq("shopify_order_id", args.orderGid);
    if (error) throw new Error(error.message);
  } catch (err) {
    logCarrierEvent("order_rollup_failed", {
      shopId: args.shopId,
      orderGid: args.orderGid,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

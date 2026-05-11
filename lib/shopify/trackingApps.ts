/**
 * Unified reader for tracking-app metafields written to Shopify by
 * AfterShip, Shipway, ParcelPanel, Wonderment, TrackingMore.
 *
 * The "Sync to Shopify" feature in each of these apps writes a few
 * key delivery fields back into Shopify metafields. Schemas differ;
 * the goal of this module is to normalize whatever the merchant's
 * tracking app supplies into a single internal shape:
 *
 *   - deliveryStatus   ("Delivered" | "InTransit" | ...)
 *   - deliveredAtTracking (ISO timestamp)
 *   - signedByName     (carrier signature recipient — gold for fraud
 *                       chargebacks)
 *   - trackingSource   (which app supplied the row)
 *
 * Why we read metafields rather than calling AfterShip's API directly:
 *   - Zero cost (merchant pays AfterShip; we just read their data
 *     out of Shopify, which is already in our scope set)
 *   - Zero merchant friction (no API key paste, no extra OAuth)
 *   - Source-agnostic — same code path supports any of the 5+ apps
 *
 * Used by:
 *   - lib/shopify/queries/ordersForBackfill.ts (aggregate KPIs on the
 *     Risk Intelligence page)
 *   - lib/packs/sources/fulfillmentSource.ts (per-dispute evidence;
 *     bank-rebuttal narrative cites "signed for by {name}" verbatim
 *     when the data is present, which is one of the strongest
 *     possible evidence types for FRAUDULENT chargebacks)
 */

/** Raw metafield as Shopify returns it. */
export interface RawShopifyMetafield {
  namespace: string;
  key: string;
  value: string;
  type?: string | null;
}

/** Unified per-order tracking signal. All fields nullable — absence
 *  of a tracking app is the common case. */
export interface UnifiedTrackingData {
  deliveryStatus:
    | "Delivered"
    | "InTransit"
    | "OutForDelivery"
    | "AttemptFail"
    | "Exception"
    | "Expired"
    | null;
  deliveredAtTracking: string | null;
  signedByName: string | null;
  trackingSource: TrackingSource | null;
}

export type TrackingSource =
  | "aftership"
  | "shipway"
  | "parcelpanel"
  | "wonderment"
  | "trackingmore";

/** Namespaces of tracking apps we know how to read. Order matters —
 *  if a merchant somehow has metafields from multiple apps, we
 *  prefer the most-installed / most-reliable. */
export const KNOWN_TRACKING_NAMESPACES: TrackingSource[] = [
  "aftership",
  "shipway",
  "wonderment",
  "parcelpanel",
  "trackingmore",
];

/** Per-app metafield key conventions. Each entry maps the unified
 *  field to the keys the app uses (in priority order — first key
 *  that resolves wins). */
const SCHEMA: Record<
  TrackingSource,
  {
    status: string[];
    deliveredAt: string[];
    signedBy: string[];
  }
> = {
  aftership: {
    status: ["tracking_status", "delivery_status"],
    deliveredAt: ["delivered_at", "delivery_status_updated_at"],
    signedBy: ["signed_by", "signature"],
  },
  shipway: {
    status: ["shipment_status", "tracking_status", "status"],
    deliveredAt: ["delivered_date", "delivered_at"],
    signedBy: ["signed_by", "receiver_name"],
  },
  parcelpanel: {
    status: ["status", "tracking_status"],
    deliveredAt: ["delivered_at", "delivery_date"],
    signedBy: ["signed_by", "signature"],
  },
  wonderment: {
    status: ["delivery_status", "status"],
    deliveredAt: ["delivered_at", "delivery_date"],
    signedBy: ["signature", "signed_by"],
  },
  trackingmore: {
    status: ["tracking_status", "delivery_status"],
    deliveredAt: ["delivered_time", "delivered_at"],
    signedBy: ["signed_by"],
  },
};

/** Each app uses different enum strings for the same logical status.
 *  Map them all to our unified vocabulary. Case-insensitive matching. */
const STATUS_MAP: Record<string, UnifiedTrackingData["deliveryStatus"]> = {
  delivered: "Delivered",
  intransit: "InTransit",
  in_transit: "InTransit",
  "in-transit": "InTransit",
  transit: "InTransit",
  pickup: "InTransit",
  outfordelivery: "OutForDelivery",
  out_for_delivery: "OutForDelivery",
  "out-for-delivery": "OutForDelivery",
  ofd: "OutForDelivery",
  attemptfail: "AttemptFail",
  attempt_fail: "AttemptFail",
  failed_attempt: "AttemptFail",
  attemptfailed: "AttemptFail",
  exception: "Exception",
  expired: "Expired",
  // Common merchant typos / casings normalized to "unknown"
  pending: null,
  notyetreceived: null,
  infoReceived: null,
  info_received: null,
};

function normalizeStatus(
  raw: string,
): UnifiedTrackingData["deliveryStatus"] {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, "");
  return STATUS_MAP[lower] ?? null;
}

/** Read the first non-empty value for any of `keys` from the group. */
function pickValue(
  group: RawShopifyMetafield[],
  keys: string[],
): string | null {
  for (const k of keys) {
    const m = group.find((mf) => mf.key === k);
    if (!m) continue;
    const v = (m.value ?? "").trim();
    if (v) return v;
  }
  return null;
}

/** Parse a metafield value into an ISO timestamp. Shopify metafields
 *  are stored as strings; tracking apps write either ISO 8601 or
 *  YYYY-MM-DD. Returns null if unparseable. */
function parseDateValue(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Read tracking-app metafields from one Shopify entity (order OR
 * fulfillment) and return the unified shape. Falls through the known
 * namespaces in priority order; the first that produces a delivery
 * status wins.
 *
 * Per-fulfillment data is more accurate than per-order (a single
 * order can have multiple shipments). Callers should pass
 * fulfillment metafields first; if that returns null deliveryStatus,
 * fall back to order metafields.
 */
export function readTrackingMetafields(
  metafields: RawShopifyMetafield[] | null | undefined,
): UnifiedTrackingData {
  const empty: UnifiedTrackingData = {
    deliveryStatus: null,
    deliveredAtTracking: null,
    signedByName: null,
    trackingSource: null,
  };
  if (!metafields || metafields.length === 0) return empty;

  // Group metafields by namespace for O(1) lookup per app.
  const byNs = new Map<string, RawShopifyMetafield[]>();
  for (const mf of metafields) {
    if (!mf?.namespace || !mf?.key) continue;
    const ns = mf.namespace.toLowerCase();
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns)!.push(mf);
  }

  for (const source of KNOWN_TRACKING_NAMESPACES) {
    const group = byNs.get(source);
    if (!group?.length) continue;
    const schema = SCHEMA[source];
    const rawStatus = pickValue(group, schema.status);
    const deliveryStatus = rawStatus ? normalizeStatus(rawStatus) : null;
    const deliveredAtRaw = pickValue(group, schema.deliveredAt);
    const deliveredAtTracking = parseDateValue(deliveredAtRaw);
    const signedByName = pickValue(group, schema.signedBy);

    // Only accept this source if it produced at least one meaningful
    // signal (status OR delivered date OR signature). An empty
    // namespace doesn't claim the slot — we try the next one.
    if (deliveryStatus || deliveredAtTracking || signedByName) {
      return {
        deliveryStatus,
        deliveredAtTracking,
        signedByName,
        trackingSource: source,
      };
    }
  }
  return empty;
}

/** Convenience: merge order-level + fulfillment-level reads. Fulfillment
 *  data wins for per-shipment accuracy; falls back to order-level when
 *  the fulfillment doesn't supply the field. */
export function mergeTrackingReads(
  fromFulfillment: UnifiedTrackingData,
  fromOrder: UnifiedTrackingData,
): UnifiedTrackingData {
  return {
    deliveryStatus:
      fromFulfillment.deliveryStatus ?? fromOrder.deliveryStatus,
    deliveredAtTracking:
      fromFulfillment.deliveredAtTracking ?? fromOrder.deliveredAtTracking,
    signedByName: fromFulfillment.signedByName ?? fromOrder.signedByName,
    trackingSource:
      fromFulfillment.trackingSource ?? fromOrder.trackingSource,
  };
}

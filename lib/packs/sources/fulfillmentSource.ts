/**
 * Fulfillment / shipping evidence source collector.
 *
 * Reads the pre-fetched OrderDetailNode from ctx.order (populated by
 * buildPack.ts) and extracts fulfillment + tracking data.
 * Contributes shipping_tracking and delivery_proof.
 *
 * Plan v3 §P2.3 — writes a `proofType` discriminator on the section's
 * payload that the canonical categorizer maps to one of:
 *   signature_confirmed → strong
 *   delivered_confirmed → moderate
 *   delivered_unverified → supporting
 *   label_created → invalid
 *
 * `signature_confirmed` requires explicit signature data from carrier
 * tracking events. The current Shopify fulfillment query does not
 * expose those events (deferred work — see TODO below), so this
 * collector currently never returns `signature_confirmed`. Whenever a
 * signature scan is wired in, branch here.
 */

import type { OrderFulfillment, OrderDetailNode } from "@/lib/shopify/queries/orders";
import type { EvidenceSection, BuildContext } from "../types";
import type { DeliveryProofType } from "@/lib/argument/canonicalEvidence";
import {
  readTrackingMetafields,
  mergeTrackingReads,
  type RawShopifyMetafield,
  type UnifiedTrackingData,
} from "@/lib/shopify/trackingApps";
import { extractNativeSignature } from "@/lib/shopify/queries/ordersForBackfill";
import { classifyDeliveryTimeline } from "@/lib/shopify/deliveryEventClassifier";

/** Signee name from a fulfillment's native carrier events (message like
 *  "Delivered, signed by ANNA ANDERSSON"). This is the ONLY signature
 *  source for merchants whose carrier app (e.g. PostNord) does not write
 *  a signed_by tracking metafield. Mirrors the KPI-ingest derivation so
 *  disputes and the Insights signed-for KPI agree. */
function nativeSignedBy(fulfillment: OrderFulfillment): string | null {
  return extractNativeSignature(
    (fulfillment.events?.edges ?? []).map((e) => e.node),
  );
}

/** Final native delivery state for a fulfillment, classified from the
 *  carrier event MESSAGE timeline (not the unreliable status enum / null
 *  deliveredAt). Returns the latest delivery-relevant category + its
 *  timestamp. See lib/shopify/deliveryEventClassifier for why. */
function nativeDelivery(fulfillment: OrderFulfillment): {
  category: "delivered" | "delivered_to_pickup" | "returned" | null;
  at: string | null;
} {
  const t = classifyDeliveryTimeline(
    (fulfillment.events?.edges ?? []).map((e) => e.node),
  );
  return { category: t.finalCategory, at: t.finalAt };
}

/** Convert a metafield edge connection into the flat array shape the
 *  tracking-apps reader expects. Tolerant of null connections. */
function flattenMetafields(
  connection: { edges: Array<{ node: { namespace: string; key: string; value: string } }> } | null,
): RawShopifyMetafield[] {
  if (!connection?.edges?.length) return [];
  return connection.edges.map((e) => ({
    namespace: e.node.namespace,
    key: e.node.key,
    value: e.node.value,
  }));
}

/** Read tracking-app metafields for one fulfillment, merging with
 *  order-level metafields as fallback. */
function readTrackingForFulfillment(
  fulfillment: OrderFulfillment,
  order: OrderDetailNode,
): UnifiedTrackingData {
  const ful = readTrackingMetafields(flattenMetafields(fulfillment.metafields ?? null));
  const ord = readTrackingMetafields(flattenMetafields(order.metafields ?? null));
  return mergeTrackingReads(ful, ord);
}

function extractTrackingData(
  fulfillment: OrderFulfillment,
  order: OrderDetailNode,
) {
  const tracking = readTrackingForFulfillment(fulfillment, order);
  return {
    fulfillmentId: fulfillment.id,
    status: fulfillment.status,
    displayStatus: fulfillment.displayStatus,
    createdAt: fulfillment.createdAt,
    deliveredAt: fulfillment.deliveredAt,
    estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
    tracking: fulfillment.trackingInfo
      .filter((t) => t.number || t.url)
      .map((t) => ({
        number: t.number,
        url: t.url,
        carrier: t.company,
      })),
    items: fulfillment.fulfillmentLineItems.edges.map((e) => ({
      title: e.node.lineItem.title,
      quantity: e.node.quantity,
    })),
    // Tracking-app metafield data (when present). signedByName is the
    // big one — it elevates the proofType to `signature_confirmed`
    // which is the strongest possible delivery-evidence tier. Falls back
    // to the native carrier event signature (PostNord et al.) when the
    // merchant has no signed_by metafield.
    carrierTracking: tracking.deliveryStatus
      ? {
          deliveryStatus: tracking.deliveryStatus,
          deliveredAtTracking: tracking.deliveredAtTracking,
          signedByName: tracking.signedByName ?? nativeSignedBy(fulfillment),
          trackingSource: tracking.trackingSource,
        }
      : null,
  };
}

/** Resolve the canonical 4-state proofType across all fulfillments.
 *  Picks the BEST tier observed (signature > delivered > unverified >
 *  label). The categorizer will downgrade strong→moderate→supporting→
 *  invalid based on this string.
 *
 *  signature_confirmed is reached when a tracking-app metafield
 *  (AfterShip / Shipway / Wonderment / etc.) carries a signed-by-
 *  name on at least one fulfillment. That's the strongest possible
 *  delivery evidence — carrier-attested human-readable signature.
 *  See lib/shopify/trackingApps.ts for the metafield reader. */
function resolveProofType(
  fulfillments: OrderFulfillment[],
  order: OrderDetailNode,
): DeliveryProofType {
  let bestTier: 0 | 1 | 2 | 3 = 0;
  for (const f of fulfillments) {
    // Signature confirmation — tracking-app metafield first, then the
    // native carrier event message (PostNord et al.). Either counts as
    // the strongest delivery evidence tier.
    const tracking = readTrackingForFulfillment(f, order);
    if (tracking.signedByName || nativeSignedBy(f)) {
      bestTier = Math.max(bestTier, 3) as 0 | 1 | 2 | 3;
      continue;
    }
    const native = nativeDelivery(f);
    // A native "returned to sender" is the opposite of delivery evidence —
    // never let it raise the tier. (rank it 0; the loop simply skips it.)
    if (native.category === "returned") continue;
    // Delivered with a corroborating timestamp: Shopify's own deliveredAt,
    // a tracking-app's Delivered+timestamp, OR a native carrier "delivered"
    // event message with a happenedAt.
    const carrierConfirmedDelivered =
      tracking.deliveryStatus === "Delivered" &&
      !!tracking.deliveredAtTracking;
    const nativeDeliveredConfirmed =
      native.category === "delivered" && !!native.at;
    if (f.deliveredAt || carrierConfirmedDelivered || nativeDeliveredConfirmed) {
      bestTier = Math.max(bestTier, 2) as 0 | 1 | 2 | 3;
      continue;
    }
    // Weaker delivery signals → unverified tier: a native "delivered to a
    // pickup point" (arrived but customer collection unconfirmed), or a
    // bare Shopify status flag with no carrier-confirmed timestamp.
    if (
      native.category === "delivered_to_pickup" ||
      native.category === "delivered" ||
      f.status === "SUCCESS" ||
      f.displayStatus === "DELIVERED"
    ) {
      bestTier = Math.max(bestTier, 1) as 0 | 1 | 2 | 3;
    }
  }
  switch (bestTier) {
    case 3: return "signature_confirmed";
    case 2: return "delivered_confirmed";
    case 1: return "delivered_unverified";
    case 0:
    default: return "label_created";
  }
}

/** The best (earliest confirmed) delivery timestamp across all
 *  fulfillments, in ISO form, or null if none is carrier-confirmed.
 *  Prefers Shopify's own `deliveredAt`, falling back to a tracking-app
 *  metafield's `deliveredAtTracking`. Lifted to the top level of the
 *  section `data` so the fact classifier (which reads `p.deliveredAt`)
 *  can pass it to the narrative writer — the LLM prompt already asks
 *  for "delivered {date}" prose when the fact carries a date. Without
 *  this the date stayed nested under `fulfillments[]` and never
 *  reached the rebuttal. */
function resolveDeliveredAt(
  fulfillments: OrderFulfillment[],
  order: OrderDetailNode,
): string | null {
  let best: string | null = null;
  for (const f of fulfillments) {
    const tracking = readTrackingForFulfillment(f, order);
    const candidate =
      (typeof f.deliveredAt === "string" ? f.deliveredAt : null) ??
      (tracking.deliveryStatus === "Delivered" ? tracking.deliveredAtTracking : null);
    if (!candidate) continue;
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

/** Signed-by name from any tracking-app metafield, if present — the
 *  strongest delivery signal. Lifted to top-level so the classified
 *  fact and the narrative writer can cite it. */
function resolveSignedByName(
  fulfillments: OrderFulfillment[],
  order: OrderDetailNode,
): string | null {
  for (const f of fulfillments) {
    const tracking = readTrackingForFulfillment(f, order);
    if (tracking.signedByName) return tracking.signedByName;
    const native = nativeSignedBy(f);
    if (native) return native;
  }
  return null;
}

export async function collectFulfillmentEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  if (!order?.fulfillments?.length) return [];

  const proofType = resolveProofType(order.fulfillments, order);

  const fieldsProvided: string[] = [];
  const hasTracking = order.fulfillments.some((f) =>
    f.trackingInfo.some((t) => t.number || t.url)
  );
  if (hasTracking) fieldsProvided.push("shipping_tracking");

  // delivery_proof is reported only when there is at least some
  // delivery signal (delivered_confirmed or stronger). For
  // delivered_unverified / label_created, the categorizer will demote
  // to supporting / invalid respectively, but the field is still
  // surfaced so the merchant can see the state.
  const hasDelivery = order.fulfillments.some(
    (f) =>
      f.deliveredAt ||
      f.status === "SUCCESS" ||
      f.displayStatus === "DELIVERED"
  );
  if (hasDelivery) fieldsProvided.push("delivery_proof");

  return [
    {
      type: "shipping",
      labelToken: {
        key: "packs.section.fulfillments",
        params: { count: order.fulfillments.length },
      },
      source: "shopify_fulfillments",
      fieldsProvided,
      data: {
        fulfillmentCount: order.fulfillments.length,
        overallStatus: order.displayFulfillmentStatus,
        // Plan §P2.3: 4-state discriminator read by the canonical
        // categorizer. Same value applies to both shipping_tracking
        // and delivery_proof since they share signalId "delivery".
        proofType,
        // Top-level delivery facts read by factClassifier.extractValue
        // (`p.deliveredAt` / `p.signedByName`) → narrative writer, which
        // cites "delivered {date}" / signature in bank-facing prose.
        deliveredAt: resolveDeliveredAt(order.fulfillments, order),
        signedByName: resolveSignedByName(order.fulfillments, order),
        fulfillments: order.fulfillments.map((f) => extractTrackingData(f, order)),
      },
    },
  ];
}

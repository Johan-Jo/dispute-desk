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
 *   returned_to_sender → invalid
 *
 * Carrier plan PR 1C (docs/plans/carrier-delivery-verification.plan.md):
 * delivery state is now resolved PER SHIPMENT across three sources —
 * tracking-app metafields, Shopify-native fulfillment events, and the
 * direct carrier-API adapters (lib/carriers) — reconciled by the
 * newest-terminal-event rule (§5.7): a later Returned beats an older
 * Delivered, a redelivery supersedes a return, and source conflicts are
 * surfaced on the payload instead of silently discarded. The carrier API
 * is only queried under the bounded rule (no terminal signal, or
 * conflicting signals) and its failures NEVER break the pack build.
 * One order ≠ one shipment (§5.6): order-level "delivered" language is
 * gated on line-item coverage; package-level evidence stays available
 * when only part of the order is confirmed.
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
import {
  resolveCarrierShipments,
  type CarrierShipmentSignal,
} from "@/lib/carriers/resolveShipments";
import {
  reconcileDeliveryState,
  type DeliverySignal,
} from "@/lib/carriers/reconcile";

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
  category: "delivered" | "collected_at_pickup" | "delivered_to_pickup" | "returned" | null;
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

const NATIVE_CATEGORY_TO_STATUS = {
  delivered: "Delivered",
  collected_at_pickup: "CollectedAtPickup",
  delivered_to_pickup: "DeliveredToPickup",
  returned: "Returned",
} as const;

/** Terminal signals already known from Shopify-side sources for ONE
 *  fulfillment: native deliveredAt, native event timeline, and a
 *  tracking-app "Delivered" metafield. Inputs to reconciliation (§5.7). */
function existingSignalsFor(
  fulfillment: OrderFulfillment,
  order: OrderDetailNode,
): DeliverySignal[] {
  const signals: DeliverySignal[] = [];
  const native = nativeDelivery(fulfillment);
  // Shopify's bare `deliveredAt` is a GENERIC delivery stamp derived
  // from the same carrier feed the event timeline comes from. When the
  // timeline classified a RECEIPT state (delivered / collected) covering
  // that moment (equal or newer timestamp), the SPECIFIC classification
  // wins and the stamp is redundant — otherwise a servicepoint
  // collection ties with its own deliveredAt stamp and the generic
  // "Delivered" masks it (real case: cay order #12121, deliveredAt ===
  // the "levererats" collection event, 2026-07-16). A RETURNED timeline
  // does NOT swallow the stamp: delivered-then-returned are two distinct
  // facts — both signals flow into reconciliation so the conflict stays
  // visible (and can trigger a live carrier lookup to settle it).
  const timelineReceiptCoversStamp =
    (native.category === "delivered" || native.category === "collected_at_pickup") &&
    !!fulfillment.deliveredAt &&
    (native.at ?? "") >= fulfillment.deliveredAt;
  if (fulfillment.deliveredAt && !timelineReceiptCoversStamp) {
    signals.push({
      status: "Delivered",
      at: fulfillment.deliveredAt,
      source: "shopify_native",
    });
  }
  if (native.category) {
    signals.push({
      status: NATIVE_CATEGORY_TO_STATUS[native.category],
      at: native.at,
      source: "shopify_native",
    });
  }
  const tracking = readTrackingForFulfillment(fulfillment, order);
  if (tracking.deliveryStatus === "Delivered") {
    signals.push({
      status: "Delivered",
      at: tracking.deliveredAtTracking,
      source: tracking.trackingSource ?? "tracking_app",
    });
  }
  return signals;
}

/** Per-fulfillment resolved delivery state after cross-source
 *  reconciliation (Shopify-native + tracking-app + carrier API). */
interface FulfillmentDeliveryState {
  /** Newest sufficiently reliable terminal signal, or null (in transit /
   *  no signal — which is NEVER treated as "not delivered"). */
  current: DeliverySignal | null;
  /** Sources disagree on terminal status — surfaced, never discarded. */
  conflict: boolean;
  signedBy: string | null;
  carrier: CarrierShipmentSignal | null;
}

type DeliveryStates = Map<string, FulfillmentDeliveryState>;

/** Resolve every fulfillment's delivery state. The carrier resolver
 *  applies the bounded lookup rule internally and never throws; a total
 *  carrier outage degrades to Shopify-side signals only. */
async function resolveDeliveryStates(
  ctx: BuildContext,
  order: OrderDetailNode,
): Promise<DeliveryStates> {
  let carrierMap = new Map<string, CarrierShipmentSignal>();
  try {
    carrierMap = await resolveCarrierShipments({
      shopId: ctx.shopId,
      orderGid: ctx.orderGid ?? order.id,
      disputeId: ctx.disputeId,
      correlationId: ctx.correlationId ?? `pack-${ctx.packId}`,
      fulfillments: order.fulfillments.map((f) => ({
        id: f.id,
        trackingInfo: f.trackingInfo.map((t) => ({
          company: t.company,
          number: t.number,
          url: t.url,
        })),
        existingSignals: existingSignalsFor(f, order),
      })),
    });
  } catch {
    // resolver never throws — belt-and-braces so the pack always builds.
  }

  const states: DeliveryStates = new Map();
  for (const f of order.fulfillments) {
    const carrier = carrierMap.get(f.id) ?? null;
    const { current, conflict } = reconcileDeliveryState([
      ...existingSignalsFor(f, order),
      carrier?.signal,
    ]);
    const tracking = readTrackingForFulfillment(f, order);
    states.set(f.id, {
      current,
      conflict,
      signedBy: tracking.signedByName ?? nativeSignedBy(f) ?? carrier?.podName ?? null,
      carrier,
    });
  }
  return states;
}

function stateOf(states: DeliveryStates, f: OrderFulfillment): FulfillmentDeliveryState {
  return (
    states.get(f.id) ?? { current: null, conflict: false, signedBy: null, carrier: null }
  );
}

/** Confirmed CUSTOMER RECEIPT with a corroborating timestamp — the
 *  moderate-tier bar. Both a doorstep delivery and an ID-verified
 *  collection at a pickup point count (in SE/Nordics collection requires
 *  photo ID / BankID — the goods are demonstrably in the customer's
 *  hands). An uncollected pickup-point arrival does NOT. */
function confirmedReceipt(
  f: OrderFulfillment,
  s: FulfillmentDeliveryState,
): boolean {
  const status = s.current?.status;
  return (
    (status === "Delivered" || status === "CollectedAtPickup") &&
    !!(s.current?.at || f.deliveredAt)
  );
}

function extractTrackingData(
  fulfillment: OrderFulfillment,
  order: OrderDetailNode,
  state: FulfillmentDeliveryState,
) {
  const tracking = readTrackingForFulfillment(fulfillment, order);
  const native = nativeDelivery(fulfillment);
  // Native carrier receipt date, when Shopify's own deliveredAt is null
  // (the common PostNord case — the delivery lives only in the event
  // message). A doorstep delivery or an ID-verified collection both
  // contribute a customer-receipt date; a pending pickup arrival does not.
  const nativeDeliveredAt =
    native.category === "delivered" || native.category === "collected_at_pickup"
      ? native.at
      : null;
  const carrierWon = !!state.current && state.current.source.startsWith("carrier_api");
  const carrierDeliveredAt =
    carrierWon &&
    (state.current?.status === "Delivered" ||
      state.current?.status === "CollectedAtPickup")
      ? state.current.at
      : null;

  // The carrier's own terminal event, citable verbatim in evidence
  // ("Picked up by receiver, X Servicepoint") — data, not UI copy.
  //
  // `state.carrier.shipment` exists only after a LIVE lookup. A cached
  // terminal hit (the normal case on every rebuild — see
  // `isTerminalCacheHit`) reuses the stored result without re-calling the
  // carrier, and the cache keeps `terminal_at` but not the event text. So
  // fall back to the reconciled winner's own timestamp with a null
  // message: the DATE is the part every surface needs, and losing it on a
  // rebuild is a silent regression.
  //
  // Caught on prod 2026-08-21: cay-collective #13195's first build
  // recorded "Shipment returned to sender / 2026-07-06T09:40", and the
  // rebuild an hour later — same data, cache hit — wrote null, so the
  // merchant saw "Returned to sender" with no date and the gate's
  // `returnedAt` was empty.
  const shipment = state.carrier?.shipment;
  const carrierTerminalEvent =
    shipment?.deliveryStatus && shipment.terminalAt
      ? {
          happenedAt: shipment.terminalAt,
          message:
            shipment.events.find((e) => e.happenedAt === shipment.terminalAt)?.message ?? null,
        }
      : carrierWon && state.current?.at
        ? { happenedAt: state.current.at, message: null }
        : null;

  return {
    fulfillmentId: fulfillment.id,
    status: fulfillment.status,
    displayStatus: fulfillment.displayStatus,
    createdAt: fulfillment.createdAt,
    deliveredAt: fulfillment.deliveredAt ?? nativeDeliveredAt ?? carrierDeliveredAt,
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
    // Reconciled per-shipment delivery state (§5.7). The carrier API's
    // result is used when reconciliation elected it (newest terminal
    // event); otherwise the tracking-app / native precedence is
    // unchanged. Provenance rides in trackingSource — a carrier-API
    // event is never presented as Shopify-supplied.
    carrierTracking: carrierWon && state.current
      ? {
          deliveryStatus: state.current.status,
          deliveredAtTracking: carrierDeliveredAt,
          signedByName: state.signedBy,
          trackingSource: state.current.source,
          // Only ever set for a Returned shipment, and null far more
          // often than not — the carrier usually does not say. A HINT
          // for the merchant's own answer, never a bank-facing claim:
          // `factClassifier` cites the merchant's `reason`, not this.
          returnReason:
            state.current.status === "Returned"
              ? (state.carrier?.returnReason ?? null)
              : null,
        }
      : tracking.deliveryStatus
        ? {
            deliveryStatus: tracking.deliveryStatus,
            deliveredAtTracking: tracking.deliveredAtTracking,
            signedByName: tracking.signedByName ?? nativeSignedBy(fulfillment),
            trackingSource: tracking.trackingSource,
          }
        : native.category
          ? {
              deliveryStatus: NATIVE_CATEGORY_TO_STATUS[native.category],
              deliveredAtTracking: nativeDeliveredAt,
              signedByName: nativeSignedBy(fulfillment),
              trackingSource: "shopify_native",
            }
          : null,
    carrierTerminalEvent,
    // Admin provenance: sources disagreed on this shipment's terminal
    // state — the reconciled winner is in carrierTracking, the conflict
    // is never silently discarded.
    sourceConflict: state.conflict,
  };
}

/** Resolve the canonical 5-state proofType across all fulfillments.
 *  Picks the BEST tier observed (signature > delivered > unverified >
 *  label). The categorizer will downgrade strong→moderate→supporting→
 *  invalid based on this string.
 *
 *  signature_confirmed is reached when a tracking-app metafield, a
 *  native carrier event message, or a carrier-API POD name carries a
 *  signee on at least one fulfillment — carrier-attested human-readable
 *  signature is the strongest possible delivery evidence.
 *
 *  A shipment whose RECONCILED state is Returned contributes NO POSITIVE
 *  TIER — including when an older Delivered event exists (stale positives
 *  are exactly what reconciliation kills). It is still RECORDED, though:
 *  when nothing else on the order reached a positive tier, the answer is
 *  `returned_to_sender`, not `label_created`.
 *
 *  That distinction is the whole point (cay-collective #13195,
 *  2026-08-20). Both states score `invalid`, so nothing about the SCORE
 *  changes — but `label_created` means "a label was printed and the
 *  carrier never scanned it", and telling that to a merchant whose parcel
 *  went out, failed delivery and came back is simply false. Every
 *  display, checklist and narrative surface downstream switches on this
 *  string, so naming the state honestly here is what lets them all stop
 *  lying at once. */
function resolveProofType(
  fulfillments: OrderFulfillment[],
  states: DeliveryStates,
): DeliveryProofType {
  let bestTier: 0 | 1 | 2 | 3 = 0;
  let sawReturned = false;
  for (const f of fulfillments) {
    const s = stateOf(states, f);
    if (s.signedBy) {
      bestTier = Math.max(bestTier, 3) as 0 | 1 | 2 | 3;
      continue;
    }
    // A reconciled return is the opposite of delivery evidence — never
    // let this shipment raise the tier. Remember it, though.
    if (s.current?.status === "Returned") {
      sawReturned = true;
      continue;
    }
    // Confirmed receipt: doorstep delivery OR ID-verified collection at a
    // pickup point, with a timestamp.
    if (confirmedReceipt(f, s)) {
      bestTier = Math.max(bestTier, 2) as 0 | 1 | 2 | 3;
      continue;
    }
    // Weaker delivery signals → unverified tier: delivered/collected
    // without a corroborating timestamp, a pickup-point ARRIVAL (customer
    // collection still pending), or a bare Shopify status flag.
    if (
      s.current?.status === "Delivered" ||
      s.current?.status === "CollectedAtPickup" ||
      s.current?.status === "DeliveredToPickup" ||
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
    default:
      // Nothing on this order reached a positive tier. If a shipment came
      // back, say so; a bare label is a different (and here, false) fact.
      return sawReturned ? "returned_to_sender" : "label_created";
  }
}

/** The best (earliest confirmed) delivery timestamp across all
 *  fulfillments, in ISO form, or null if none is carrier-confirmed.
 *  Reads the RECONCILED per-shipment state, so a shipment that was later
 *  returned no longer contributes its stale delivery date. Lifted to the
 *  top level of the section `data` so the fact classifier (which reads
 *  `p.deliveredAt`) can pass it to the narrative writer. */
function resolveDeliveredAt(
  fulfillments: OrderFulfillment[],
  states: DeliveryStates,
): string | null {
  let best: string | null = null;
  for (const f of fulfillments) {
    const s = stateOf(states, f);
    // Customer-receipt date: doorstep delivery or ID-verified collection.
    // For a collection this matches the carrier's own record verbatim
    // (PostNord/DHL word the collection event "levererats"/"delivered").
    if (
      s.current?.status !== "Delivered" &&
      s.current?.status !== "CollectedAtPickup"
    ) {
      continue;
    }
    const candidate = s.current.at ?? f.deliveredAt ?? null;
    if (!candidate) continue;
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

/** Signed-by name from any source (tracking-app metafield, native event
 *  message, carrier-API POD), if present — the strongest delivery
 *  signal. Lifted to top-level so the classified fact and the narrative
 *  writer can cite it. */
function resolveSignedByName(
  fulfillments: OrderFulfillment[],
  states: DeliveryStates,
): string | null {
  for (const f of fulfillments) {
    const s = stateOf(states, f);
    if (s.signedBy) return s.signedBy;
  }
  return null;
}

/* RETIRED 2026-08-07 (PR-C1) — `shippedToVerifiedAddress`, `hasFinalDelivery`
 * and `confirmedAddressDelivery` are deleted, not disabled.
 *
 * `shippedToVerifiedAddress` compared Shopify's OWN billing and shipping
 * addresses on city + country — two merchant-held addresses — and fed
 * `deliveredToVerifiedAddress`, which upgraded a confirmed delivery to STRONG
 * and licensed the issuer-facing "delivered to the verified address" claim.
 * The rule it purported to satisfy (Visa §4 Compelling Evidence chart Item 3:
 * "delivered to the same physical address for which the Merchant received an
 * qualifying AVS match — register R-E, encoded in `lib/argument/avsCodeMap.ts`)
 * requires an AVS result. This derivation read no AVS
 * code at any point. Measured on production before removal: 60 packs asserted
 * a verified address, and on 54 of them the issuer's own AVS response was `N`.
 *
 * Deleted rather than hard-wired to `false` on purpose: a branch that can never
 * be true still reads as live logic to the next author (the `locationMatch ===
 * "match"` branch in `ip_location_check` sat dead for a month for exactly that
 * reason). Reintroduction requires the four-part evidentiary contract recorded
 * in `docs/technical.md` § Delivery evidence, and its own approval.
 */

/** §5.6 — does the delivered portion cover the disputed merchandise?
 *  "complete" = delivered quantity ≥ ordered quantity; "partial" = some
 *  but not all; "none" = nothing delivered; "unknown" = the order's line
 *  items are unavailable (never guess). Order-level definitive language
 *  is reserved for "complete" (or "unknown", where per-shipment evidence
 *  is all we have) — one delivered package must not speak for the whole
 *  order. */
export type DeliveryCoverage = "complete" | "partial" | "none" | "unknown";

function resolveDeliveryCoverage(
  order: OrderDetailNode,
  states: DeliveryStates,
): DeliveryCoverage {
  const orderQty = (order.lineItems?.edges ?? []).reduce(
    (sum, e) => sum + (e.node.quantity ?? 0),
    0,
  );
  if (!orderQty) return "unknown";
  let deliveredQty = 0;
  for (const f of order.fulfillments) {
    const s = stateOf(states, f);
    // Coverage counts confirmed RECEIPT — a collected parcel is in the
    // customer's hands just as surely as a doorstep-delivered one.
    if (!confirmedReceipt(f, s)) continue;
    deliveredQty += f.fulfillmentLineItems.edges.reduce(
      (sum, e) => sum + (e.node.quantity ?? 0),
      0,
    );
  }
  if (deliveredQty <= 0) return "none";
  return deliveredQty >= orderQty ? "complete" : "partial";
}

/* RETIRED 2026-08-07 (PR-C1) — `resolveCollectedByCustomer` is deleted.
 *
 * It set a STRONG upgrade from `state.current.status === "CollectedAtPickup"`
 * plus a timestamp. That status comes from `deliveryEventClassifier` matching
 * carrier event MESSAGE TEXT against `COLLECTED_ROOTS`. No signature, no
 * identification, no BankID artifact was read or required — `signedBy` is a
 * separate field and was null on every production pack carrying the flag. The
 * "collection requires photo ID / BankID in SE/Nordic networks" justification
 * was a jurisdictional assumption in a comment, not data in the payload.
 *
 * Collection at a pickup point remains CONFIRMED RECEIPT (`confirmedReceipt`
 * still admits it, so `proofType` is still `delivered_confirmed` → Moderate).
 * Only the inferred STRONG upgrade is gone. A genuine signature / POD name
 * still yields `signature_confirmed` → Strong, unchanged.
 */

export async function collectFulfillmentEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  const order = ctx.order;
  if (!order?.fulfillments?.length) return [];

  const states = await resolveDeliveryStates(ctx, order);
  const proofType = resolveProofType(order.fulfillments, states);
  const coverage = resolveDeliveryCoverage(order, states);

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
      f.displayStatus === "DELIVERED" ||
      stateOf(states, f).current?.status === "Delivered" ||
      stateOf(states, f).current?.status === "CollectedAtPickup" ||
      stateOf(states, f).current?.status === "DeliveredToPickup"
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
        deliveredAt: resolveDeliveredAt(order.fulfillments, states),
        signedByName: resolveSignedByName(order.fulfillments, states),
        // NOTE (PR-C1, 2026-08-07): `deliveredToVerifiedAddress` and
        // `collectedByCustomer` are NOT written here any more. Both were
        // unsupported STRONG upgrades — see the retirement notes above and
        // `lib/evidence/model/retiredKeys.ts`. Historical packs still carry
        // them; every derivation strips them at the boundary.
        // §5.6 — complete | partial | none | unknown. Package-level rows
        // below stay citable when only part of the order is confirmed.
        deliveryCoverage: coverage,
        // §5.7 — any shipment whose sources disagreed (admin provenance).
        sourceConflict: order.fulfillments.some((f) => stateOf(states, f).conflict),
        fulfillments: order.fulfillments.map((f) =>
          extractTrackingData(f, order, stateOf(states, f)),
        ),
      },
    },
  ];
}

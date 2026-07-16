/**
 * Dispute-triggered carrier-shipment resolution — plan §5.7/§5.8.
 *
 * Orchestrates, per fulfillment: detection (registry) → bounded lookup
 * rule → cache → carrier API → classification → persistence → alerting.
 *
 * BOUNDED LOOKUP RULE (v1): the carrier API is queried for a shipment
 * only when the existing sources (Shopify-native events, tracking-app
 * metafields) produced NO terminal signal, or when they CONFLICT. A
 * cached terminal carrier result is reused without an API call; cached
 * non-terminal or failed lookups are eligible for re-fetch on the next
 * build (§5.7 triggers 1, 4, 5, 7 — staleness-window and materiality
 * triggers 2/3/6 are documented follow-ups).
 *
 * FAILURE CONTRACT: this module NEVER throws. Every failure is logged,
 * classified, alert-routed per §6.5 (isolated not_found = log only;
 * ambiguous/auth/config/schema/timeout/outage/rate-limit notify with
 * persistent dedup), and the pack build continues without carrier
 * evidence. Absence is never turned into negative delivery language.
 */

import { detectCarrier } from "@/lib/carriers/registry";
import {
  logCarrierEvent,
  reportCarrierFailure,
  reportUnsupportedCarrier,
} from "@/lib/carriers/alerts";
import {
  cachedSignal,
  getCachedLookups,
  isTerminalCacheHit,
  persistCarrierLookup,
  rollupOrderDelivery,
  trackingKeyOf,
  type CachedLookup,
} from "@/lib/carriers/lookupCache";
import {
  reconcileDeliveryState,
  type DeliverySignal,
} from "@/lib/carriers/reconcile";
import type {
  CarrierLookupStatus,
  NormalizedCarrierShipment,
  TrackingEntryInfo,
} from "@/lib/carriers/types";

export interface FulfillmentForResolution {
  id: string;
  trackingInfo: TrackingEntryInfo[];
  /** Terminal signals already known from Shopify-native events and
   *  tracking-app metafields for THIS fulfillment. */
  existingSignals: DeliverySignal[];
}

export interface CarrierShipmentSignal {
  fulfillmentId: string;
  carrier: string;
  /** Terminal carrier signal, when the lookup produced one. */
  signal: DeliverySignal | null;
  /** Full normalized shipment on a live success (absent on cache hits). */
  shipment?: NormalizedCarrierShipment;
  lookupStatus: CarrierLookupStatus | "cache_hit";
  /** POD/recipient name when the carrier reports one. */
  podName: string | null;
}

/** not_found is log/metric only unless a pattern emerges (§6.5); every
 *  other non-success outcome notifies (with persistent dedup). */
const EMAIL_WORTHY: Record<string, Parameters<typeof reportCarrierFailure>[0]["category"] | undefined> = {
  ambiguous: "ambiguous_match",
  rate_limited: "rate_limited",
  authentication_error: "authentication_error",
  timeout: "timeout",
  network_error: "network_error",
  unavailable: "carrier_unavailable",
  invalid_response: "invalid_response",
  configuration_missing: "configuration_missing",
  unexpected_error: "unexpected_error",
};

const RETRYABLE = new Set(["rate_limited", "timeout", "network_error", "unavailable"]);

export async function resolveCarrierShipments(input: {
  shopId: string;
  orderGid: string;
  disputeId: string | null;
  correlationId: string;
  fulfillments: FulfillmentForResolution[];
}): Promise<Map<string, CarrierShipmentSignal>> {
  const out = new Map<string, CarrierShipmentSignal>();
  try {
    const cache = await getCachedLookups(
      input.shopId,
      input.fulfillments.map((f) => f.id),
    );

    for (const f of input.fulfillments) {
      try {
        const resolved = await resolveOne(input, f, cache);
        if (resolved) out.set(f.id, resolved);
      } catch (err) {
        // Belt-and-braces: a bug in resolution must never fail the pack.
        logCarrierEvent("unexpected_error", {
          stage: "resolve_fulfillment",
          fulfillmentId: f.id,
          correlationId: input.correlationId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logCarrierEvent("unexpected_error", {
      stage: "resolve_shipments",
      correlationId: input.correlationId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return out;
}

async function resolveOne(
  input: {
    shopId: string;
    orderGid: string;
    disputeId: string | null;
    correlationId: string;
  },
  f: FulfillmentForResolution,
  cache: Map<string, CachedLookup>,
): Promise<CarrierShipmentSignal | null> {
  const existing = reconcileDeliveryState(f.existingSignals);
  // Bounded rule: skip the carrier entirely when Shopify-side sources
  // already agree on a terminal state (§5.7 v1).
  const needLookup = existing.current === null || existing.conflict;

  for (const entry of f.trackingInfo) {
    const detection = detectCarrier(entry);

    if (detection.outcome === "no_tracking") continue;

    if (detection.outcome === "unknown_carrier") {
      logCarrierEvent("unknown_carrier_detected", {
        shopId: input.shopId,
        orderGid: input.orderGid,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
      continue;
    }

    if (detection.outcome === "unsupported_carrier") {
      // Report only when the missing adapter actually costs us evidence —
      // a carrier that syncs natively (e.g. PostNord) already delivered a
      // terminal signal, and alerting on every healthy shipment would
      // drown the demand signal in noise.
      if (!needLookup) continue;
      await reportUnsupportedCarrier({
        carrier: detection.carrier,
        companyRaw: entry.company,
        identifiedFrom: detection.identifiedFrom,
        trackingUrl: entry.url,
        shopId: input.shopId,
        orderGid: input.orderGid,
        disputeId: input.disputeId,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
      continue;
    }

    if (detection.outcome === "identifier_unresolved") {
      logCarrierEvent("identifier_unresolved", {
        carrier: detection.carrier,
        shopId: input.shopId,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
      continue;
    }

    const { match, adapter } = detection;

    // A cached TERMINAL carrier result always participates in
    // reconciliation — even when Shopify-side sources have their own
    // signal. Skipping it here would let a stale native "Delivered"
    // outlive a newer cached carrier "Returned" (§5.7). Only the LIVE
    // API call below is subject to the bounded rule.
    const key = `${f.id}|${trackingKeyOf(entry)}`;
    const cached = cache.get(key);
    if (isTerminalCacheHit(cached)) {
      logCarrierEvent("cache_hit_terminal", {
        carrier: match.carrier,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
      return {
        fulfillmentId: f.id,
        carrier: match.carrier,
        signal: cachedSignal(cached!),
        lookupStatus: "cache_hit",
        podName: null,
      };
    }

    // Bounded rule: no live lookup when Shopify-side sources already
    // agree on a terminal state.
    if (!needLookup) {
      logCarrierEvent("lookup_skipped_existing_signal", {
        carrier: detection.carrier,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
      continue;
    }

    logCarrierEvent("lookup_attempt", {
      carrier: match.carrier,
      matchedFrom: match.matchedFrom,
      confidence: match.confidence,
      fulfillmentId: f.id,
      correlationId: input.correlationId,
    });

    const result = await adapter.fetchTimeline(match.trackingNumber);

    const carrierSignal: DeliverySignal | null =
      result.status === "success" && result.shipment.deliveryStatus
        ? {
            status: result.shipment.deliveryStatus,
            at: result.shipment.terminalAt,
            source: `carrier_api_${match.carrier}`,
          }
        : null;
    // The carrier signal "wins" when reconciliation elects it over the
    // Shopify-side signals (newest-terminal-event rule) — a losing or
    // absent carrier result never overrides an existing positive event.
    const carrierWon =
      !!carrierSignal &&
      reconcileDeliveryState([...f.existingSignals, carrierSignal]).current === carrierSignal;

    await persistCarrierLookup({
      shopId: input.shopId,
      orderGid: input.orderGid,
      fulfillmentId: f.id,
      entry,
      match,
      adapterVersion: adapter.version,
      lookupStatus: result.status,
      shipment: result.status === "success" ? result.shipment : undefined,
      carrierWon,
    });

    if (result.status === "success") {
      logCarrierEvent("lookup_success", {
        carrier: match.carrier,
        terminal: !!carrierSignal,
        status: result.shipment.deliveryStatus,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
      if (carrierSignal && carrierWon) {
        await rollupOrderDelivery({
          shopId: input.shopId,
          orderGid: input.orderGid,
          signal: carrierSignal,
          signedByName: result.shipment.podName,
        });
      }
      return {
        fulfillmentId: f.id,
        carrier: match.carrier,
        signal: carrierSignal,
        shipment: result.shipment,
        lookupStatus: result.status,
        podName: result.shipment.podName,
      };
    }

    if (result.status === "not_found") {
      // Isolated not_found: a legitimate carrier response, not an
      // operational incident (§6.5). Logged + measured only.
      logCarrierEvent("lookup_not_found", {
        carrier: match.carrier,
        fulfillmentId: f.id,
        correlationId: input.correlationId,
      });
    } else {
      const category = EMAIL_WORTHY[result.status];
      if (category) {
        await reportCarrierFailure({
          category,
          carrier: match.carrier,
          adapterName: adapter.slug,
          adapterVersion: adapter.version,
          shopId: input.shopId,
          orderGid: input.orderGid,
          disputeId: input.disputeId,
          fulfillmentId: f.id,
          correlationId: input.correlationId,
          httpStatus: undefined,
          retryable: RETRYABLE.has(result.status),
          sanitizedMessage: `carrier lookup returned ${result.status}`,
          trackingRef: match.trackingNumber,
        });
      }
    }
    return {
      fulfillmentId: f.id,
      carrier: match.carrier,
      signal: null,
      lookupStatus: result.status,
      podName: null,
    };
  }
  return null;
}

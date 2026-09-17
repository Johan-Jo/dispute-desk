/**
 * Dispute-triggered carrier-shipment resolution — plan §5.7/§5.8.
 *
 * Orchestrates, per fulfillment: detection (registry) → bounded lookup
 * rule → cache → carrier API → classification → persistence → alerting.
 *
 * ALWAYS-VERIFY RULE (v2, 2026-07): the carrier API is queried for
 * evidentiary STRENGTH whenever a supported adapter matches — even when
 * Shopify-side sources already report a terminal "delivered" state. A
 * carrier POD (recipient/signature + carrier-attested timestamp) is a
 * materially stronger delivery proof than Shopify's generic feed, so we
 * fetch it rather than settle for the weaker signal. This SUPERSEDES the
 * old bounded rule (query only on no-signal/conflict).
 *
 * Two safeguards keep "always verify" cheap and safe:
 *   - COST: a fresh TERMINAL carrier-cache hit still short-circuits with
 *     zero API calls (isTerminalCacheHit, below) — we never re-fetch a
 *     shipment the carrier already POD-confirmed. Only shipments lacking
 *     a terminal *carrier* result incur the extra lookup; cached
 *     non-terminal / failed lookups remain eligible for re-fetch.
 *   - NO DOWNGRADE: a losing or absent carrier result NEVER overrides an
 *     existing positive event. Reconciliation elects the newest terminal
 *     event (`carrierWon`), and persistence only writes terminal columns
 *     when the carrier won — so a carrier result can only ADD strength or
 *     confirm, never turn a delivered order into "not delivered".
 *
 * Because a missing adapter now ALWAYS costs us the stronger signal, an
 * identified-but-unsupported carrier ALWAYS emits the unsupported-carrier
 * detection email (dedup: one per merchant+carrier per 7 days).
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
  cachedReturnReason,
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
import { fetchParcelPanelState } from "@/lib/carriers/trackingApps/parcelPanelSource";
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
  /** Carrier-suggested reason a RETURNED shipment went back, from the
   *  live classification or — on a cache hit, where the event timeline is
   *  long gone — the persisted column. Null is the common answer. */
  returnReason: string | null;
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

/**
 * Tracking-app lookups permitted per pack build (per ORDER, across all its
 * shipments).
 *
 * The source paces itself at 5s per shop domain against a throttling
 * endpoint, so this is a wall-clock bound in disguise: 3 lookups ≈ 10s added
 * to a build. Almost every disputed order has one or two shipments, so in
 * practice nothing is skipped; a pathological 10-parcel order degrades to
 * "the first three are verified" rather than stalling the build for a minute.
 */
const MAX_TRACKING_APP_LOOKUPS_PER_BUILD = 3;

export async function resolveCarrierShipments(input: {
  shopId: string;
  orderGid: string;
  disputeId: string | null;
  correlationId: string;
  /** Storefront host the Shopify app proxy is mounted on (`shops.primary_domain`),
   *  used for tracking-app lookups. Absent — or still the `*.myshopify.com`
   *  host — simply disables them; nothing else changes. */
  storefrontDomain?: string | null;
  fulfillments: FulfillmentForResolution[];
}): Promise<Map<string, CarrierShipmentSignal>> {
  const out = new Map<string, CarrierShipmentSignal>();
  // ONE budget for the whole order, not per shipment — see
  // `tryTrackingAppSource` for why this is bounded by count.
  const budget = { remaining: MAX_TRACKING_APP_LOOKUPS_PER_BUILD };
  try {
    const cache = await getCachedLookups(
      input.shopId,
      input.fulfillments.map((f) => f.id),
    );

    for (const f of input.fulfillments) {
      try {
        const resolved = await resolveOne(input, f, cache, budget);
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

/**
 * Ask the merchant's own tracking app about a shipment whose carrier we have
 * no adapter for.
 *
 * ── Why this is bounded ──────────────────────────────────────────────
 *
 * The ParcelPanel endpoint throttles. Measured 2026-09-16: 40 requests at 2s
 * apart throttle at #29; 40 at 4s are clean. The source paces itself at 5s
 * per shop domain, which means a 6-parcel order would add ~30s to a pack
 * build. `MAX_TRACKING_APP_LOOKUPS_PER_BUILD` caps that: the first few
 * shipments are looked up, the rest fall through exactly as before.
 *
 * Bounding on COUNT rather than elapsed time is deliberate — a time budget
 * makes the pack's contents depend on how busy the box was, so the same
 * order could produce different evidence on two runs.
 *
 * ── Why `unavailable` returns null ───────────────────────────────────
 *
 * `unavailable` means we could not find out (throttled, 5xx, changed shape,
 * or — because ParcelPanel answers 403 for an unknown parcel too — possibly
 * no such tracking number). It is NOT a fact about the parcel, so it must
 * not become a signal. Returning null leaves this shipment exactly as it was
 * before this branch existed: Shopify-side sources only.
 *
 * What `unavailable` must NOT do is silently license an auto-filing on
 * delivery data we failed to verify. That is the submission-time freshness
 * work (plan §8.1) and it is deliberately NOT decided here — this function
 * only ever ADDS knowledge, never removes a guard.
 */
async function tryTrackingAppSource(args: {
  input: {
    shopId: string;
    orderGid: string;
    disputeId: string | null;
    correlationId: string;
    storefrontDomain?: string | null;
  };
  fulfillmentId: string;
  entry: TrackingEntryInfo;
  carrier: string;
  budget: { remaining: number };
}): Promise<CarrierShipmentSignal | null> {
  const { input, fulfillmentId, entry, carrier, budget } = args;

  const domain = (input.storefrontDomain ?? "").trim();
  const number = (entry.number ?? "").trim();
  if (!domain || !number) return null;

  if (budget.remaining <= 0) {
    logCarrierEvent("tracking_app_budget_exhausted", {
      carrier,
      fulfillmentId,
      correlationId: input.correlationId,
    });
    return null;
  }
  budget.remaining -= 1;

  const result = await fetchParcelPanelState({
    shopDomain: domain,
    trackingNumber: number,
  });

  if (result.outcome === "unavailable") {
    logCarrierEvent("tracking_app_unavailable", {
      carrier,
      fulfillmentId,
      reason: result.reason,
      correlationId: input.correlationId,
    });
    return null;
  }

  if (result.outcome === "no_terminal_state") {
    // A FACT: we looked, the parcel is still moving. Distinct from
    // `unavailable`, and still not a terminal signal.
    logCarrierEvent("tracking_app_no_terminal_state", {
      carrier,
      fulfillmentId,
      correlationId: input.correlationId,
    });
    return null;
  }

  logCarrierEvent("tracking_app_signal", {
    carrier,
    fulfillmentId,
    status: result.status,
    correlationId: input.correlationId,
  });

  return {
    fulfillmentId,
    carrier,
    signal: {
      status: result.status,
      // `date_carbon` is naive local time with no zone (see parcelPanelMap).
      // Kept verbatim: reconciliation compares these lexicographically and
      // inventing a UTC offset we cannot verify would be worse than none.
      at: result.at,
      source: result.source,
    },
    lookupStatus: "success",
    podName: null,
    returnReason: null,
  };
}

async function resolveOne(
  input: {
    shopId: string;
    orderGid: string;
    disputeId: string | null;
    correlationId: string;
    storefrontDomain?: string | null;
  },
  f: FulfillmentForResolution,
  cache: Map<string, CachedLookup>,
  budget: { remaining: number },
): Promise<CarrierShipmentSignal | null> {
  // Always-verify (v2): we no longer gate the carrier lookup on whether
  // Shopify-side sources already have a terminal signal — a carrier POD
  // is stronger evidence, so we fetch it regardless. Cost is bounded by
  // the terminal-cache short-circuit below; safety by the no-downgrade
  // reconciliation (`carrierWon`). `f.existingSignals` still feeds that
  // reconciliation further down.
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
      // Under always-verify a missing adapter ALWAYS costs us the stronger
      // carrier POD — even for a carrier that syncs a terminal signal
      // natively — so we always surface the demand signal. Email dedup is
      // per merchant+carrier over a 7-day window (alerts.ts), so "always
      // report" is at most one email per merchant+carrier per week, not a
      // storm.
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

      // No adapter — but the MERCHANT may already pay a tracking app that
      // queries this carrier for them. Ask it before giving up.
      //
      // This branch used to `continue` here, which is how dispute 4b81afe1
      // (#98141) filed a not-as-described defence on a parcel ParcelPanel had
      // classified as returned-to-sender nine hours before the chargeback
      // opened. The demand-signal email above told us we were blind; it could
      // not tell us what we were blind TO.
      const appSignal = await tryTrackingAppSource({
        input,
        fulfillmentId: f.id,
        entry,
        carrier: detection.carrier,
        budget,
      });
      if (appSignal) return appSignal;
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
        returnReason: cachedReturnReason(cached),
      };
    }

    // Always-verify: proceed to the live lookup for strength even when
    // Shopify-side sources already reported delivered. The terminal
    // carrier-cache hit above already short-circuited the only case where
    // a fetch would be wasted (the carrier itself already POD-confirmed
    // this shipment).
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
        returnReason: result.shipment.returnReason,
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
      returnReason: null,
    };
  }
  return null;
}

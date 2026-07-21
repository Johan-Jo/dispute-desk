import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * resolveShipments — always-verify (v2) behavior lock.
 *
 * The 2026-07 change removed the bounded-lookup gate: the carrier API is
 * now queried for evidentiary strength EVEN WHEN Shopify-side sources
 * already report a terminal "delivered" state. These tests pin:
 *   1. always-verify — a supported adapter is called despite an existing
 *      Shopify "Delivered" signal (previously skipped);
 *   2. cost guard — a fresh terminal carrier CACHE hit still short-circuits
 *      (no adapter call);
 *   3. no-downgrade — a losing/absent carrier result never overrides the
 *      existing positive (no rollup, terminal columns untouched);
 *   4. unsupported carrier ALWAYS emits the detection email, even when
 *      Shopify already reported delivered.
 */

// Mock the DB + alert side-effects so the orchestrator runs in isolation.
const getCachedLookups = vi.fn<(...a: unknown[]) => Promise<Map<string, unknown>>>();
const persistCarrierLookup = vi.fn(async () => {});
const rollupOrderDelivery = vi.fn(async () => {});
const isTerminalCacheHit = vi.fn<(...a: unknown[]) => boolean>(() => false);
const cachedSignal = vi.fn<(...a: unknown[]) => unknown>(() => null);

vi.mock("@/lib/carriers/lookupCache", () => ({
  getCachedLookups: (...a: unknown[]) => getCachedLookups(...(a as [])),
  persistCarrierLookup: (...a: unknown[]) => persistCarrierLookup(...(a as [])),
  rollupOrderDelivery: (...a: unknown[]) => rollupOrderDelivery(...(a as [])),
  isTerminalCacheHit: (...a: unknown[]) => isTerminalCacheHit(...(a as [])),
  cachedSignal: (...a: unknown[]) => cachedSignal(...(a as [])),
  trackingKeyOf: (e: { number?: string | null }) => e.number ?? "k",
}));

const reportUnsupportedCarrier = vi.fn<(...a: [{ carrier: string }]) => Promise<void>>(async () => {});
const reportCarrierFailure = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/carriers/alerts", () => ({
  reportUnsupportedCarrier: (...a: unknown[]) => reportUnsupportedCarrier(...(a as [{ carrier: string }])),
  reportCarrierFailure: (...a: unknown[]) => reportCarrierFailure(...(a as unknown[])),
  logCarrierEvent: () => {},
}));

import { resolveCarrierShipments } from "@/lib/carriers/resolveShipments";
import { registerCarrierAdapter } from "@/lib/carriers/registry";
import type { CarrierAdapter, CarrierLookupResult } from "@/lib/carriers/types";
import type { DeliverySignal } from "@/lib/carriers/reconcile";

/** A controllable adapter registered under a REAL identified slug so
 *  detectCarrier resolves it to `matched`. */
function makeAdapter(
  slug: "dhl",
  result: CarrierLookupResult,
  spy: { calls: string[] },
): CarrierAdapter {
  return {
    slug,
    version: `${slug}@test`,
    match(info) {
      const number = (info.number ?? "").trim();
      return number ? { carrier: slug, trackingNumber: number, matchedFrom: "company_and_number", confidence: "high" } : null;
    },
    async fetchTimeline(trackingNumber) {
      spy.calls.push(trackingNumber);
      return result;
    },
  };
}

const shopifyDelivered: DeliverySignal = {
  status: "Delivered",
  at: "2026-07-13T14:26:00Z",
  source: "shopify_native",
};

const baseInput = (existingSignals: DeliverySignal[]) => ({
  shopId: "shop-1",
  orderGid: "gid://shopify/Order/1",
  disputeId: "dispute-1",
  correlationId: "corr-1",
  fulfillments: [
    {
      id: "ful-1",
      trackingInfo: [{ company: "DHL", number: "373325386394209542", url: null }],
      existingSignals,
    },
  ],
});

describe("resolveCarrierShipments — always-verify", () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    getCachedLookups.mockResolvedValue(new Map());
    isTerminalCacheHit.mockReturnValue(false);
    persistCarrierLookup.mockClear();
    rollupOrderDelivery.mockClear();
    reportUnsupportedCarrier.mockClear();
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.clearAllMocks();
  });

  it("queries the carrier for strength even when Shopify already says Delivered", async () => {
    const spy = { calls: [] as string[] };
    // Carrier returns a stronger signature POD for the same delivery.
    unregister = registerCarrierAdapter(
      makeAdapter("dhl", {
        status: "success",
        shipment: {
          trackingNumber: "373325386394209542",
          events: [],
          deliveryStatus: "Delivered",
          terminalAt: "2026-07-13T14:26:00Z",
          podName: "FRONT DOOR",
        },
      }, spy),
    );

    const out = await resolveCarrierShipments(baseInput([shopifyDelivered]));
    // The whole point of v2: the lookup was NOT skipped.
    expect(spy.calls).toEqual(["373325386394209542"]);
    expect(out.get("ful-1")?.podName).toBe("FRONT DOOR");
  });

  it("still short-circuits on a fresh terminal carrier cache hit (cost guard)", async () => {
    const spy = { calls: [] as string[] };
    unregister = registerCarrierAdapter(
      makeAdapter("dhl", { status: "not_found" }, spy),
    );
    // A terminal cache hit exists for this shipment.
    getCachedLookups.mockResolvedValue(new Map([["ful-1|373325386394209542", { terminal: true }]]));
    isTerminalCacheHit.mockReturnValue(true);
    cachedSignal.mockReturnValue(shopifyDelivered);

    const out = await resolveCarrierShipments(baseInput([shopifyDelivered]));
    // No live adapter call — the cache answered.
    expect(spy.calls).toEqual([]);
    expect(out.get("ful-1")?.lookupStatus).toBe("cache_hit");
  });

  it("never downgrades: a not_found carrier result leaves the Shopify positive intact (no rollup)", async () => {
    const spy = { calls: [] as string[] };
    unregister = registerCarrierAdapter(makeAdapter("dhl", { status: "not_found" }, spy));

    const out = await resolveCarrierShipments(baseInput([shopifyDelivered]));
    expect(spy.calls).toEqual(["373325386394209542"]); // it did look
    // ...but a null/absent carrier signal never wins → no rollup write.
    expect(rollupOrderDelivery).not.toHaveBeenCalled();
    expect(out.get("ful-1")?.signal).toBeNull();
  });

  it("unsupported carrier ALWAYS alerts, even when Shopify already reported delivered", async () => {
    // No adapter registered for the tracking carrier → unsupported.
    const input = {
      shopId: "shop-1",
      orderGid: "gid://shopify/Order/2",
      disputeId: "dispute-2",
      correlationId: "corr-2",
      fulfillments: [
        {
          id: "ful-2",
          trackingInfo: [{ company: "PostNord SE", number: "PN123", url: null }],
          existingSignals: [shopifyDelivered],
        },
      ],
    };
    await resolveCarrierShipments(input);
    expect(reportUnsupportedCarrier).toHaveBeenCalledTimes(1);
    expect(reportUnsupportedCarrier.mock.calls[0][0]).toMatchObject({ carrier: "postnord" });
  });
});

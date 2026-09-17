/**
 * The tracking-app fallback inside `resolveCarrierShipments`.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §7, §8.
 *
 * ── What this closes ─────────────────────────────────────────────────
 *
 * The `unsupported_carrier` branch used to send the demand-signal email and
 * then `continue`. That email told us we were blind; it could not tell us
 * what we were blind TO. Dispute 4b81afe1 (#98141) filed a not-as-described
 * defence on a parcel ParcelPanel had classified as returned-to-sender nine
 * hours before the chargeback opened.
 *
 * These tests pin the branch's three obligations: ask the tracking app, treat
 * `unavailable` as an absence rather than a fact, and stay bounded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchParcelPanelState = vi.fn();
const reportUnsupportedCarrier = vi.fn().mockResolvedValue(undefined);
const logCarrierEvent = vi.fn();

vi.mock("@/lib/carriers/trackingApps/parcelPanelSource", () => ({
  fetchParcelPanelState: (...a: unknown[]) => fetchParcelPanelState(...a),
}));
vi.mock("@/lib/carriers/alerts", () => ({
  logCarrierEvent: (...a: unknown[]) => logCarrierEvent(...a),
  reportCarrierFailure: vi.fn().mockResolvedValue(undefined),
  reportUnsupportedCarrier: (...a: unknown[]) => reportUnsupportedCarrier(...a),
}));
vi.mock("@/lib/carriers/lookupCache", () => ({
  getCachedLookups: vi.fn().mockResolvedValue(new Map()),
  cachedSignal: vi.fn(),
  cachedReturnReason: vi.fn(),
  isTerminalCacheHit: vi.fn().mockReturnValue(false),
  persistCarrierLookup: vi.fn().mockResolvedValue(undefined),
  rollupOrderDelivery: vi.fn().mockResolvedValue(undefined),
  trackingKeyOf: (e: { number?: string | null }) => e.number ?? "k",
}));

const { resolveCarrierShipments } = await import("../resolveShipments");

/** One YunExpress shipment — identified, no adapter. */
function shipment(id: string, number: string) {
  return {
    id,
    trackingInfo: [{ company: "YunExpress", number, url: null }],
    existingSignals: [],
  };
}

const baseInput = {
  shopId: "shop-1",
  orderGid: "gid://shopify/Order/1",
  disputeId: "dispute-1",
  correlationId: "corr-1",
  storefrontDomain: "meinmaison.de",
};

beforeEach(() => {
  fetchParcelPanelState.mockReset();
  reportUnsupportedCarrier.mockClear();
  logCarrierEvent.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("an unsupported carrier now asks the merchant's tracking app", () => {
  it("turns a Returned into a usable signal", async () => {
    fetchParcelPanelState.mockResolvedValue({
      outcome: "signal",
      status: "Returned",
      at: "2026-09-07 09:17:41",
      source: "tracking_app_parcelpanel",
    });

    const out = await resolveCarrierShipments({
      ...baseInput,
      fulfillments: [shipment("f1", "YT2622600704220350")],
    });

    const got = out.get("f1");
    expect(got?.signal).toMatchObject({
      status: "Returned",
      at: "2026-09-07 09:17:41",
      source: "tracking_app_parcelpanel",
    });
    // The demand-signal email still fires — we still lack an adapter, and
    // that remains worth knowing.
    expect(reportUnsupportedCarrier).toHaveBeenCalledTimes(1);
  });

  it("still reports the unsupported carrier even when the app has no answer", async () => {
    fetchParcelPanelState.mockResolvedValue({
      outcome: "no_terminal_state",
      source: "tracking_app_parcelpanel",
    });

    const out = await resolveCarrierShipments({
      ...baseInput,
      fulfillments: [shipment("f1", "X1")],
    });

    expect(out.get("f1")).toBeUndefined();
    expect(reportUnsupportedCarrier).toHaveBeenCalledTimes(1);
  });
});

describe("`unavailable` is an absence, never a fact", () => {
  it.each(["http_403", "http_5xx", "timeout", "shape_mismatch"] as const)(
    "%s produces NO signal — the shipment is left exactly as before",
    async (reason) => {
      fetchParcelPanelState.mockResolvedValue({
        outcome: "unavailable",
        reason,
        source: "tracking_app_parcelpanel",
      });

      const out = await resolveCarrierShipments({
        ...baseInput,
        fulfillments: [shipment("f1", "X1")],
      });

      // Crucially: not an entry with `signal: null` that downstream code
      // might read as "checked, nothing there" — no entry at all.
      expect(out.has("f1")).toBe(false);
      expect(
        logCarrierEvent.mock.calls.some(([e]) => e === "tracking_app_unavailable"),
      ).toBe(true);
    },
  );

  it("a 403 never becomes a Returned, however tempting", async () => {
    // ParcelPanel answers 403 for an unknown parcel AND for a throttle, so
    // this is the assertion that keeps the two apart.
    fetchParcelPanelState.mockResolvedValue({
      outcome: "unavailable",
      reason: "http_403",
      source: "tracking_app_parcelpanel",
    });
    const out = await resolveCarrierShipments({
      ...baseInput,
      fulfillments: [shipment("f1", "X1")],
    });
    expect([...out.values()].some((v) => v.signal)).toBe(false);
  });
});

describe("the lookup is bounded", () => {
  it("stops after the per-build budget and lets the rest fall through", async () => {
    fetchParcelPanelState.mockResolvedValue({
      outcome: "signal",
      status: "Returned",
      at: "2026-09-07 09:17:41",
      source: "tracking_app_parcelpanel",
    });

    const many = Array.from({ length: 7 }, (_, i) => shipment(`f${i}`, `T${i}`));
    await resolveCarrierShipments({ ...baseInput, fulfillments: many });

    // 3 looked up, 4 skipped — the source paces at 5s/request, so an
    // unbounded 7-parcel order would add ~35s to the build.
    expect(fetchParcelPanelState).toHaveBeenCalledTimes(3);
    expect(
      logCarrierEvent.mock.calls.filter(([e]) => e === "tracking_app_budget_exhausted"),
    ).toHaveLength(4);
  });
});

describe("the lookup is skipped when it cannot possibly work", () => {
  it("no storefront domain → no request", async () => {
    const out = await resolveCarrierShipments({
      ...baseInput,
      storefrontDomain: null,
      fulfillments: [shipment("f1", "X1")],
    });
    expect(fetchParcelPanelState).not.toHaveBeenCalled();
    expect(out.has("f1")).toBe(false);
    // The demand signal is unaffected — that is about the adapter gap, not
    // about whether this particular shop has a proxy we can reach.
    expect(reportUnsupportedCarrier).toHaveBeenCalledTimes(1);
  });

  it("no tracking number → no request", async () => {
    await resolveCarrierShipments({
      ...baseInput,
      fulfillments: [
        { id: "f1", trackingInfo: [{ company: "YunExpress", number: null, url: null }], existingSignals: [] },
      ],
    });
    expect(fetchParcelPanelState).not.toHaveBeenCalled();
  });

  it("a SUPPORTED carrier never reaches the tracking-app path", async () => {
    // DHL has an adapter; this branch is only for carriers that do not.
    await resolveCarrierShipments({
      ...baseInput,
      fulfillments: [
        { id: "f1", trackingInfo: [{ company: "DHL", number: "D1", url: null }], existingSignals: [] },
      ],
    });
    expect(fetchParcelPanelState).not.toHaveBeenCalled();
  });
});

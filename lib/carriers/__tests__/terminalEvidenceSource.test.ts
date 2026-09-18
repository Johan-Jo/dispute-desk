/**
 * `isTerminalEvidenceSource` — the §6.1 integration point.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §6.1, test 6.
 *
 * The bug this guards against is subtle and was nearly shipped: a
 * tracking-app `Returned` signal reconciles correctly and WINS the election,
 * yet `fulfillmentSource` only populated the per-shipment `carrierTracking`
 * block when the winning source started with `carrier_api`. So the
 * returned-to-sender gate — which reads
 * `carrierTracking.deliveryStatus === "Returned"` — would have stayed dark,
 * and the pack would have kept arguing a delivery that never happened, with
 * the correct signal sitting one field away.
 */

import { describe, it, expect } from "vitest";
import { isTerminalEvidenceSource, reconcileDeliveryState } from "../reconcile";

describe("isTerminalEvidenceSource", () => {
  it("admits carrier APIs and vetted tracking apps", () => {
    expect(isTerminalEvidenceSource("carrier_api_dhl")).toBe(true);
    expect(isTerminalEvidenceSource("carrier_api")).toBe(true);
    expect(isTerminalEvidenceSource("tracking_app_parcelpanel")).toBe(true);
  });

  it("does NOT admit Shopify-native signals", () => {
    // Native is the baseline every other path already reads. Admitting it
    // here would let a stale native flag masquerade as an observed result.
    expect(isTerminalEvidenceSource("shopify_native")).toBe(false);
  });

  it("does not admit an unprefixed or unknown source", () => {
    expect(isTerminalEvidenceSource("tracking_app")).toBe(false); // no trailing _
    expect(isTerminalEvidenceSource("guesswork")).toBe(false);
    expect(isTerminalEvidenceSource("")).toBe(false);
  });
});

describe("a tracking-app Returned survives reconciliation AND the source gate", () => {
  it("wins over a stale native Delivered and is admitted (test 6)", () => {
    // The #98141 shape: Shopify still says delivered-to-pickup on 08-31,
    // ParcelPanel says returned on 09-07.
    const { current, conflict } = reconcileDeliveryState([
      { status: "DeliveredToPickup", at: "2026-08-31T11:17:41Z", source: "shopify_native" },
      { status: "Returned", at: "2026-09-07T09:17:41Z", source: "tracking_app_parcelpanel" },
    ]);

    expect(current?.status).toBe("Returned");
    expect(conflict).toBe(true); // the disagreement is surfaced, not hidden
    // ...and the winning source is one `carrierTracking` will actually be
    // populated from. Before the widening this was false and the gate stayed
    // dark despite the election being correct.
    expect(isTerminalEvidenceSource(current!.source)).toBe(true);
  });

  it("a later native Delivered still beats an earlier tracking-app Returned", () => {
    // No-downgrade cuts both ways: newest terminal event wins regardless of
    // which source produced it.
    const { current } = reconcileDeliveryState([
      { status: "Returned", at: "2026-09-01T09:00:00Z", source: "tracking_app_parcelpanel" },
      { status: "Delivered", at: "2026-09-05T12:00:00Z", source: "shopify_native" },
    ]);
    expect(current?.status).toBe("Delivered");
  });
});

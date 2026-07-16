import { describe, it, expect } from "vitest";
import { reconcileDeliveryState, type DeliverySignal } from "@/lib/carriers/reconcile";

const sig = (
  status: DeliverySignal["status"],
  at: string | null,
  source = "shopify_native",
): DeliverySignal => ({ status, at, source });

describe("reconcileDeliveryState (§5.7 — newest sufficiently reliable terminal event)", () => {
  it("no signals → no current state, no conflict (absence is not evidence)", () => {
    expect(reconcileDeliveryState([])).toEqual({ current: null, conflict: false });
    expect(reconcileDeliveryState([null, undefined])).toEqual({ current: null, conflict: false });
  });

  it("a later Returned beats an older Delivered (no stale positives)", () => {
    const r = reconcileDeliveryState([
      sig("Delivered", "2026-06-04T10:00:00Z"),
      sig("Returned", "2026-06-20T10:00:00Z", "carrier_api_dhl"),
    ]);
    expect(r.current?.status).toBe("Returned");
    expect(r.conflict).toBe(true);
  });

  it("a later redelivery supersedes an earlier return", () => {
    const r = reconcileDeliveryState([
      sig("Returned", "2026-06-10T10:00:00Z"),
      sig("Delivered", "2026-06-25T10:00:00Z", "carrier_api_dhl"),
    ]);
    expect(r.current?.status).toBe("Delivered");
  });

  it("DeliveredToPickup stays distinct from Delivered", () => {
    const r = reconcileDeliveryState([sig("DeliveredToPickup", "2026-06-04T10:00:00Z")]);
    expect(r.current?.status).toBe("DeliveredToPickup");
    expect(r.conflict).toBe(false);
  });

  it("an undated signal loses to any dated signal", () => {
    const r = reconcileDeliveryState([
      sig("Delivered", null, "aftership"),
      sig("Returned", "2026-06-01T00:00:00Z"),
    ]);
    expect(r.current?.status).toBe("Returned");
  });

  it("on a timestamp tie the carrier API's own record wins", () => {
    const r = reconcileDeliveryState([
      sig("Delivered", "2026-06-04T10:00:00Z", "shopify_native"),
      sig("DeliveredToPickup", "2026-06-04T10:00:00Z", "carrier_api_dhl"),
    ]);
    expect(r.current?.source).toBe("carrier_api_dhl");
  });

  it("agreeing sources are not a conflict", () => {
    const r = reconcileDeliveryState([
      sig("Delivered", "2026-06-04T10:00:00Z"),
      sig("Delivered", "2026-06-04T12:00:00Z", "carrier_api_dhl"),
    ]);
    expect(r.conflict).toBe(false);
    expect(r.current?.at).toBe("2026-06-04T12:00:00Z");
  });
});

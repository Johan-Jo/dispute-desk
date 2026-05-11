import { describe, it, expect } from "vitest";
import {
  readTrackingMetafields,
  mergeTrackingReads,
  type RawShopifyMetafield,
} from "@/lib/shopify/trackingApps";

const mf = (
  namespace: string,
  key: string,
  value: string,
): RawShopifyMetafield => ({ namespace, key, value });

describe("readTrackingMetafields — null + empty", () => {
  it("returns all-null when input is null or empty", () => {
    const empty = {
      deliveryStatus: null,
      deliveredAtTracking: null,
      signedByName: null,
      trackingSource: null,
    };
    expect(readTrackingMetafields(null)).toEqual(empty);
    expect(readTrackingMetafields(undefined)).toEqual(empty);
    expect(readTrackingMetafields([])).toEqual(empty);
  });

  it("ignores metafields outside known tracking namespaces", () => {
    const result = readTrackingMetafields([
      mf("custom", "delivery_status", "Delivered"),
      mf("foo", "tracking_status", "Delivered"),
    ]);
    expect(result.trackingSource).toBeNull();
    expect(result.deliveryStatus).toBeNull();
  });
});

describe("readTrackingMetafields — AfterShip", () => {
  it("normalizes Delivered + signed_by + delivered_at", () => {
    const r = readTrackingMetafields([
      mf("aftership", "tracking_status", "Delivered"),
      mf("aftership", "delivered_at", "2026-04-21T14:30:00Z"),
      mf("aftership", "signed_by", "JOHN DOE"),
    ]);
    expect(r.trackingSource).toBe("aftership");
    expect(r.deliveryStatus).toBe("Delivered");
    expect(r.deliveredAtTracking).toBe("2026-04-21T14:30:00.000Z");
    expect(r.signedByName).toBe("JOHN DOE");
  });

  it("falls back to delivery_status key when tracking_status is absent", () => {
    const r = readTrackingMetafields([
      mf("aftership", "delivery_status", "InTransit"),
    ]);
    expect(r.deliveryStatus).toBe("InTransit");
    expect(r.trackingSource).toBe("aftership");
  });

  it("normalizes case-insensitively", () => {
    const r = readTrackingMetafields([
      mf("aftership", "tracking_status", "DELIVERED"),
    ]);
    expect(r.deliveryStatus).toBe("Delivered");
  });

  it("handles snake_case + dashed status enums", () => {
    expect(
      readTrackingMetafields([
        mf("aftership", "tracking_status", "out_for_delivery"),
      ]).deliveryStatus,
    ).toBe("OutForDelivery");
    expect(
      readTrackingMetafields([
        mf("aftership", "tracking_status", "in-transit"),
      ]).deliveryStatus,
    ).toBe("InTransit");
  });

  it("returns null deliveredAtTracking for unparseable dates", () => {
    expect(
      readTrackingMetafields([
        mf("aftership", "tracking_status", "Delivered"),
        mf("aftership", "delivered_at", "not-a-date"),
      ]).deliveredAtTracking,
    ).toBeNull();
  });
});

describe("readTrackingMetafields — Shipway", () => {
  it("reads shipment_status + delivered_date", () => {
    const r = readTrackingMetafields([
      mf("shipway", "shipment_status", "delivered"),
      mf("shipway", "delivered_date", "2026-04-22"),
    ]);
    expect(r.trackingSource).toBe("shipway");
    expect(r.deliveryStatus).toBe("Delivered");
    expect(r.deliveredAtTracking).toContain("2026-04-22");
  });
});

describe("readTrackingMetafields — ParcelPanel", () => {
  it("reads status + delivered_at", () => {
    const r = readTrackingMetafields([
      mf("parcelpanel", "status", "Pickup"),
      mf("parcelpanel", "delivered_at", "2026-04-15T10:00:00Z"),
    ]);
    expect(r.trackingSource).toBe("parcelpanel");
    expect(r.deliveryStatus).toBe("InTransit"); // Pickup maps to InTransit
    expect(r.deliveredAtTracking).toBe("2026-04-15T10:00:00.000Z");
  });
});

describe("readTrackingMetafields — Wonderment", () => {
  it("reads delivery_status + signature", () => {
    const r = readTrackingMetafields([
      mf("wonderment", "delivery_status", "delivered"),
      mf("wonderment", "signature", "Jane Smith"),
    ]);
    expect(r.trackingSource).toBe("wonderment");
    expect(r.deliveryStatus).toBe("Delivered");
    expect(r.signedByName).toBe("Jane Smith");
  });
});

describe("readTrackingMetafields — priority order across multiple apps", () => {
  it("prefers AfterShip when both AfterShip and Shipway have data", () => {
    const r = readTrackingMetafields([
      mf("aftership", "tracking_status", "Delivered"),
      mf("aftership", "signed_by", "AfterShipPerson"),
      mf("shipway", "shipment_status", "exception"),
    ]);
    expect(r.trackingSource).toBe("aftership");
    expect(r.deliveryStatus).toBe("Delivered");
    expect(r.signedByName).toBe("AfterShipPerson");
  });

  it("falls through to Shipway when AfterShip has only empty values", () => {
    const r = readTrackingMetafields([
      mf("aftership", "tracking_status", ""),
      mf("shipway", "shipment_status", "delivered"),
    ]);
    expect(r.trackingSource).toBe("shipway");
    expect(r.deliveryStatus).toBe("Delivered");
  });
});

describe("readTrackingMetafields — defensive parsing", () => {
  it("returns null status for unknown enum values without crashing", () => {
    const r = readTrackingMetafields([
      mf("aftership", "tracking_status", "weird_status_we_dont_know"),
    ]);
    expect(r.deliveryStatus).toBeNull();
  });

  it("skips namespaces that produce no meaningful signal", () => {
    // AfterShip has the namespace but no values — should fall to Shipway
    const r = readTrackingMetafields([
      mf("aftership", "unrelated_key", "ignored"),
      mf("shipway", "shipment_status", "delivered"),
    ]);
    expect(r.trackingSource).toBe("shipway");
  });
});

describe("mergeTrackingReads", () => {
  it("prefers fulfillment-level data over order-level for each field", () => {
    const ful = {
      deliveryStatus: "Delivered" as const,
      deliveredAtTracking: "2026-04-22T10:00:00Z",
      signedByName: "Ful Signer",
      trackingSource: "aftership" as const,
    };
    const ord = {
      deliveryStatus: "InTransit" as const,
      deliveredAtTracking: "2026-04-21T10:00:00Z",
      signedByName: null,
      trackingSource: "shipway" as const,
    };
    const m = mergeTrackingReads(ful, ord);
    expect(m.deliveryStatus).toBe("Delivered");
    expect(m.deliveredAtTracking).toBe("2026-04-22T10:00:00Z");
    expect(m.signedByName).toBe("Ful Signer");
    expect(m.trackingSource).toBe("aftership");
  });

  it("falls back to order-level when fulfillment is missing each field", () => {
    const ful = {
      deliveryStatus: null,
      deliveredAtTracking: null,
      signedByName: null,
      trackingSource: null,
    };
    const ord = {
      deliveryStatus: "Delivered" as const,
      deliveredAtTracking: "2026-04-22T10:00:00Z",
      signedByName: "Order Signer",
      trackingSource: "aftership" as const,
    };
    const m = mergeTrackingReads(ful, ord);
    expect(m.deliveryStatus).toBe("Delivered");
    expect(m.deliveredAtTracking).toBe("2026-04-22T10:00:00Z");
    expect(m.signedByName).toBe("Order Signer");
    expect(m.trackingSource).toBe("aftership");
  });
});

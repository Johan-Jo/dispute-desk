import { describe, it, expect } from "vitest";
import {
  bucketOrdersByUtcDay,
  testOrderGidSet,
  type OrderForSnapshot,
} from "@/lib/shopify/queries/ordersForSnapshot";

/**
 * Regression: the chargeback-rate snapshot used to call Shopify
 * `ordersCount` per UTC day, which returned wrong counts for narrow
 * `created_at:>=...Z created_at:<...Z` filters and double-counted
 * orders straddling day boundaries (verified against surasvenne,
 * 2026-05-01: window-level=7 vs per-day-summed=14). The fix moves
 * to the orders LIST connection, fetched once per window, and groups
 * by UTC date in code via these pure helpers. These tests pin the
 * helper behavior so the regression can't slip back in.
 */

const order = (
  partial: Partial<OrderForSnapshot> & Pick<OrderForSnapshot, "createdAt">,
): OrderForSnapshot => ({
  gid: partial.gid ?? `gid://shopify/Order/${Math.random().toString(36).slice(2, 10)}`,
  isTest: partial.isTest ?? false,
  createdAt: partial.createdAt,
});

describe("bucketOrdersByUtcDay", () => {
  it("groups multiple orders on the same UTC day into a single bucket", () => {
    const orders: OrderForSnapshot[] = [
      order({ createdAt: "2026-04-21T16:50:34Z" }),
      order({ createdAt: "2026-04-21T17:28:46Z" }),
      order({ createdAt: "2026-04-21T23:59:59Z" }),
    ];
    const buckets = bucketOrdersByUtcDay(orders);
    expect(buckets.size).toBe(1);
    expect(buckets.get("2026-04-21")).toBe(3);
  });

  it("never double-counts an order across UTC day boundaries", () => {
    // Three orders on three distinct UTC days; the prior `ordersCount`
    // bug double-counted into adjacent days. Each order must land in
    // exactly one bucket.
    const orders: OrderForSnapshot[] = [
      order({ createdAt: "2026-04-19T16:11:36Z" }),
      order({ createdAt: "2026-04-20T22:34:35Z" }),
      order({ createdAt: "2026-04-21T16:50:34Z" }),
    ];
    const buckets = bucketOrdersByUtcDay(orders);
    expect(buckets.size).toBe(3);
    expect(buckets.get("2026-04-19")).toBe(1);
    expect(buckets.get("2026-04-20")).toBe(1);
    expect(buckets.get("2026-04-21")).toBe(1);
    // Sum across buckets must equal real-orders count (no inflation).
    const sum = [...buckets.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(orders.length);
  });

  it("anchors orders to UTC day, not local-shop time, even at midnight edges", () => {
    // 23:59 UTC on day N stays on N; 00:00 UTC on day N+1 lands on
    // N+1. The bucket boundary is strictly UTC midnight.
    const orders: OrderForSnapshot[] = [
      order({ createdAt: "2026-04-19T23:59:59Z" }),
      order({ createdAt: "2026-04-20T00:00:00Z" }),
    ];
    const buckets = bucketOrdersByUtcDay(orders);
    expect(buckets.get("2026-04-19")).toBe(1);
    expect(buckets.get("2026-04-20")).toBe(1);
  });

  it("counts test orders alongside real orders (post-2026-05-01 revert)", () => {
    // The test-order exclusion was removed so dev shops with
    // Bogus-Gateway orders surface realistic numbers. The
    // `testOrderGidSet` helper still tags them for the eventual
    // prod re-enable.
    const orders: OrderForSnapshot[] = [
      order({ createdAt: "2026-04-21T10:00:00Z", isTest: false }),
      order({ createdAt: "2026-04-21T11:00:00Z", isTest: true }),
      order({ createdAt: "2026-04-21T12:00:00Z", isTest: true }),
    ];
    const buckets = bucketOrdersByUtcDay(orders);
    expect(buckets.get("2026-04-21")).toBe(3);
  });

  it("returns an empty map when given no orders", () => {
    expect(bucketOrdersByUtcDay([]).size).toBe(0);
  });
});

describe("testOrderGidSet", () => {
  it("collects only the GIDs of test orders", () => {
    const orders: OrderForSnapshot[] = [
      order({ createdAt: "2026-04-21T10:00:00Z", isTest: false, gid: "gid://Order/A" }),
      order({ createdAt: "2026-04-21T11:00:00Z", isTest: true, gid: "gid://Order/B" }),
      order({ createdAt: "2026-04-21T12:00:00Z", isTest: true, gid: "gid://Order/C" }),
    ];
    const set = testOrderGidSet(orders);
    expect(set.size).toBe(2);
    expect(set.has("gid://Order/B")).toBe(true);
    expect(set.has("gid://Order/C")).toBe(true);
    expect(set.has("gid://Order/A")).toBe(false);
  });

  it("is empty when no test orders exist", () => {
    const orders: OrderForSnapshot[] = [
      order({ createdAt: "2026-04-21T10:00:00Z", isTest: false }),
    ];
    expect(testOrderGidSet(orders).size).toBe(0);
  });
});

describe("regression — surasvenne 2026-05-01 case", () => {
  it("the 7 real orders in the 30d window bucket to exactly the right per-day counts", () => {
    // Exact `createdAt` timestamps pulled from surasvenne via
    // `scripts/diagnose-orders-timezone.mjs` (2026-05-01). Before the
    // fix, the per-day Shopify `ordersCount` calls summed to 14 for
    // these 7 orders. The bucket helper must return exactly 7.
    const orders: OrderForSnapshot[] = [
      order({ gid: "1068", createdAt: "2026-04-15T14:48:27Z" }),
      order({ gid: "1069", createdAt: "2026-04-19T16:11:36Z" }),
      order({ gid: "1070", createdAt: "2026-04-20T22:34:35Z" }),
      order({ gid: "1071", createdAt: "2026-04-21T16:50:34Z" }),
      order({ gid: "1072", createdAt: "2026-04-21T17:28:46Z" }),
      order({ gid: "1073", createdAt: "2026-04-23T13:07:19Z" }),
      order({ gid: "1074", createdAt: "2026-04-24T12:27:04Z" }),
    ];
    const buckets = bucketOrdersByUtcDay(orders);
    expect([...buckets.values()].reduce((a, b) => a + b, 0)).toBe(7);
    expect(buckets.get("2026-04-15")).toBe(1);
    expect(buckets.get("2026-04-19")).toBe(1);
    expect(buckets.get("2026-04-20")).toBe(1);
    expect(buckets.get("2026-04-21")).toBe(2);
    expect(buckets.get("2026-04-23")).toBe(1);
    expect(buckets.get("2026-04-24")).toBe(1);
  });
});

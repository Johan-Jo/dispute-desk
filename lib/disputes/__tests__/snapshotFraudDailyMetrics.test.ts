import { describe, it, expect } from "vitest";
import { aggregateOrderCounts } from "@/lib/disputes/snapshotFraudDailyMetrics";

/**
 * Unit tests for the pure aggregation core of the fraud-rollup
 * pipeline. The orchestrator + cron paths are integration-tested
 * end-to-end on a real Supabase; these tests pin the buckets that
 * the dashboard tooltip copy commits to.
 */

const row = (overrides: Partial<{
  risk_level_initial: string | null;
  fulfillment_status: string | null;
  fraud_protection_level: string | null;
  order_total: number | string | null;
}> = {}) => ({
  risk_level_initial: null,
  fulfillment_status: null,
  fraud_protection_level: null,
  order_total: 0,
  ...overrides,
});

describe("aggregateOrderCounts — risk buckets", () => {
  it("buckets each risk_level_initial value into its dedicated counter", () => {
    const out = aggregateOrderCounts([
      row({ risk_level_initial: "LOW" }),
      row({ risk_level_initial: "LOW" }),
      row({ risk_level_initial: "MEDIUM" }),
      row({ risk_level_initial: "HIGH" }),
      row({ risk_level_initial: "PENDING" }),
      row({ risk_level_initial: "NONE" }),
    ]);
    expect(out.ordersTotal).toBe(6);
    expect(out.ordersLow).toBe(2);
    expect(out.ordersMedium).toBe(1);
    expect(out.ordersHigh).toBe(1);
    expect(out.ordersPending).toBe(1);
    expect(out.ordersNone).toBe(1);
  });

  it("buckets null risk_level_initial as 'none' (not pending)", () => {
    // Critical: PRD §13 acceptance-rate denominator = low + medium.
    // Null risk must NOT be counted as pending (which would inflate
    // the "still being analyzed" bucket and understate acceptance).
    const out = aggregateOrderCounts([
      row({ risk_level_initial: null }),
      row({ risk_level_initial: null }),
    ]);
    expect(out.ordersNone).toBe(2);
    expect(out.ordersPending).toBe(0);
  });

  it("is case-insensitive on the risk_level_initial value", () => {
    const out = aggregateOrderCounts([
      row({ risk_level_initial: "high" }),
      row({ risk_level_initial: "Medium" }),
    ]);
    expect(out.ordersHigh).toBe(1);
    expect(out.ordersMedium).toBe(1);
  });
});

describe("aggregateOrderCounts — fulfilled high-risk", () => {
  it("counts FULFILLED + PARTIAL high-risk orders, ignores others", () => {
    const out = aggregateOrderCounts([
      row({ risk_level_initial: "HIGH", fulfillment_status: "FULFILLED" }),
      row({ risk_level_initial: "HIGH", fulfillment_status: "PARTIAL" }),
      row({ risk_level_initial: "HIGH", fulfillment_status: "UNFULFILLED" }),
      row({ risk_level_initial: "HIGH", fulfillment_status: null }),
      // Non-HIGH FULFILLED orders must not contribute — they aren't
      // part of the high-risk fulfillment-rate denominator either.
      row({ risk_level_initial: "LOW", fulfillment_status: "FULFILLED" }),
    ]);
    expect(out.ordersHigh).toBe(4);
    expect(out.ordersFulfilledHighRisk).toBe(2);
  });

  it("treats PARTIALLY_FULFILLED as a fulfilled state", () => {
    const out = aggregateOrderCounts([
      row({
        risk_level_initial: "HIGH",
        fulfillment_status: "PARTIALLY_FULFILLED",
      }),
    ]);
    expect(out.ordersFulfilledHighRisk).toBe(1);
  });
});

describe("aggregateOrderCounts — Protect coverage value", () => {
  it("sums PROTECTED order totals into fullyProtectedValue", () => {
    const out = aggregateOrderCounts([
      row({ fraud_protection_level: "PROTECTED", order_total: 100 }),
      row({ fraud_protection_level: "PROTECTED", order_total: 50 }),
      row({ fraud_protection_level: "NOT_PROTECTED", order_total: 999 }),
    ]);
    expect(out.fullyProtectedValue).toBe(150);
  });

  it("counts PROTECTED, ACTIVE, and PENDING toward eligibleProtectedValue", () => {
    const out = aggregateOrderCounts([
      row({ fraud_protection_level: "PROTECTED", order_total: 100 }),
      row({ fraud_protection_level: "ACTIVE", order_total: 50 }),
      row({ fraud_protection_level: "PENDING", order_total: 25 }),
      row({ fraud_protection_level: "INACTIVE", order_total: 999 }),
      row({ fraud_protection_level: "NOT_PROTECTED", order_total: 999 }),
    ]);
    expect(out.eligibleProtectedValue).toBe(175);
  });

  it("excludes zero/negative/null totals and missing status", () => {
    const out = aggregateOrderCounts([
      row({ fraud_protection_level: "PROTECTED", order_total: 0 }),
      row({ fraud_protection_level: "PROTECTED", order_total: null }),
      row({ fraud_protection_level: null, order_total: 100 }),
    ]);
    expect(out.fullyProtectedValue).toBe(0);
    expect(out.eligibleProtectedValue).toBe(0);
  });

  it("accepts numeric totals delivered as strings (Postgres numeric)", () => {
    const out = aggregateOrderCounts([
      row({ fraud_protection_level: "PROTECTED", order_total: "120.50" }),
    ]);
    expect(out.fullyProtectedValue).toBe(120.5);
  });
});

describe("aggregateOrderCounts — empty input", () => {
  it("returns a zeroed-out counts object", () => {
    const out = aggregateOrderCounts([]);
    expect(out).toEqual({
      ordersTotal: 0,
      ordersLow: 0,
      ordersMedium: 0,
      ordersHigh: 0,
      ordersNone: 0,
      ordersPending: 0,
      ordersFulfilledHighRisk: 0,
      fullyProtectedValue: 0,
      eligibleProtectedValue: 0,
    });
  });
});

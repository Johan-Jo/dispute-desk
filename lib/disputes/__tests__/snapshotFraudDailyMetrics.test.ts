import { describe, it, expect, vi } from "vitest";
import {
  aggregateOrderCounts,
  backfillFraudDailyMetrics,
} from "@/lib/disputes/snapshotFraudDailyMetrics";

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

// ═══ Backfill pagination regression ═════════════════════════════════
// PostgREST silently caps un-ranged selects at 1000 rows. The original
// date scan in backfillFraudDailyMetrics had no .range() loop, so a
// 12.8k-order shop's backfill only saw its first 1000 rows and wrote
// rollups for ~285 scattered dates — leaving the insights MoM prior
// window empty ("no prior period" on every KPI tile; K-Collective,
// 2026-07-17). This test serves the scan in 1000-row pages with a date
// that ONLY appears on page 2 and asserts it still gets rolled up.

interface FakeQuery {
  table: string;
  select: string;
  rangeFrom: number | null;
  rangeTo: number | null;
}

function makeFakeSupabase(
  scanRows: Array<{ processed_at: string | null; created_at_shopify: string | null }>,
  existingRollups: Array<{ date: string; last_synced_at: string | null }> = [],
) {
  const upsertedDates: string[] = [];
  const makeBuilder = (table: string) => {
    const q: FakeQuery = { table, select: "", rangeFrom: null, rangeTo: null };
    const resolve = () => {
      if (q.table === "shopify_orders" && q.select.includes("risk_level_initial")) {
        return { data: [], error: null }; // per-day rows: empty day is fine
      }
      const from = q.rangeFrom ?? 0;
      // Emulate PostgREST: honor the requested range, cap at 1000.
      const to = q.rangeTo === null ? from + 999 : Math.min(q.rangeTo, from + 999);
      if (q.table === "shopify_orders") {
        return { data: scanRows.slice(from, to + 1), error: null };
      }
      if (q.table === "shop_fraud_daily_metrics") {
        return { data: existingRollups.slice(from, to + 1), error: null };
      }
      return { data: [], error: null }; // disputes
    };
    const builder: Record<string, unknown> = {
      select: (s: string) => ((q.select = s), builder),
      eq: () => builder,
      or: () => builder,
      gte: () => builder,
      lt: () => builder,
      order: () => builder,
      range: (f: number, t: number) => ((q.rangeFrom = f), (q.rangeTo = t), builder),
      upsert: (row: { date: string }) => {
        upsertedDates.push(row.date);
        return Promise.resolve({ error: null });
      },
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled),
    };
    return builder;
  };
  return {
    client: { from: (table: string) => makeBuilder(table) },
    upsertedDates,
  };
}

describe("backfillFraudDailyMetrics — scan pagination", () => {
  it("rolls up dates that only appear beyond the first 1000 rows", async () => {
    // 1000 rows on day one, then 500 rows on a second day that an
    // un-paginated scan would never see.
    const scanRows = [
      ...Array.from({ length: 1000 }, () => ({
        processed_at: "2026-01-01T10:00:00Z",
        created_at_shopify: "2026-01-01T10:00:00Z",
      })),
      ...Array.from({ length: 500 }, () => ({
        processed_at: "2026-01-02T10:00:00Z",
        created_at_shopify: "2026-01-02T10:00:00Z",
      })),
    ];
    const fake = makeFakeSupabase(scanRows);
    const serverModule = await import("@/lib/supabase/server");
    const spy = vi
      .spyOn(serverModule, "getServiceClient")
      .mockReturnValue(fake.client as never);
    try {
      const out = await backfillFraudDailyMetrics("shop-1");
      expect(out.daysWritten).toBe(2);
      // Newest-first: the dashboard's trailing windows fill before deep
      // history, so a timeout-truncated attempt still helps — and the
      // next retry resumes instead of re-doing this prefix.
      expect(fake.upsertedDates).toEqual(["2026-01-02", "2026-01-01"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("skips dates whose rollup row is already fresh (retry resume)", async () => {
    const scanRows = [
      { processed_at: "2026-01-01T10:00:00Z", created_at_shopify: "2026-01-01T10:00:00Z" },
      { processed_at: "2026-01-02T10:00:00Z", created_at_shopify: "2026-01-02T10:00:00Z" },
    ];
    // Date 2 was written moments ago (a previous timed-out attempt);
    // date 1's row is ancient and must refresh.
    const fake = makeFakeSupabase(scanRows, [
      { date: "2026-01-01", last_synced_at: "2020-01-01T00:00:00Z" },
      { date: "2026-01-02", last_synced_at: new Date().toISOString() },
    ]);
    const serverModule = await import("@/lib/supabase/server");
    const spy = vi
      .spyOn(serverModule, "getServiceClient")
      .mockReturnValue(fake.client as never);
    try {
      const out = await backfillFraudDailyMetrics("shop-1");
      expect(out.daysWritten).toBe(1);
      expect(out.daysSkipped).toBe(1);
      expect(fake.upsertedDates).toEqual(["2026-01-01"]);
    } finally {
      spy.mockRestore();
    }
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

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the chargeback rate computation against
 * `shop_daily_metrics`. Stubs the Supabase service client to return
 * canned snapshot rows; never hits the network.
 *
 * Coverage:
 *   - Numerator/denominator summation across multi-day windows
 *   - One-decimal-place rate rounding
 *   - `available: false` when the snapshot is missing
 *   - `available: true` + `rate: null` when there are zero orders
 *   - Low-volume gating at the < 50 orders threshold
 *   - Period-over-period delta in percentage points
 *   - All-time mode (no fromDate) sums every shop row
 */

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  computeChargebackRate,
  windowStartDate,
} from "@/lib/disputes/chargebackRate";

const mockGetServiceClient = vi.mocked(getServiceClient);

interface SnapshotRow {
  date: string;
  order_count: number;
  chargeback_count: number;
  last_synced_at: string;
}

/**
 * Build a stub Supabase client whose
 * `from("shop_daily_metrics").select(...).eq().lte().gte()` returns
 * `rows` filtered by date inside the chain. Multiple sequential
 * `readWindow()` calls (current + prior period) share the same row
 * pool — the helper filters per chained `.gte/.lte` boundary.
 */
function stubClient(rows: SnapshotRow[]) {
  const builder = (filter: { from?: string; to?: string }) => {
    const matching = rows.filter((r) => {
      if (filter.from && r.date < filter.from) return false;
      if (filter.to && r.date > filter.to) return false;
      return true;
    });
    return Promise.resolve({ data: matching, error: null });
  };
  let pendingFilter: { from?: string; to?: string } = {};
  const chain = {
    select: vi.fn().mockImplementation(() => chain),
    eq: vi.fn().mockImplementation(() => chain),
    lte: vi.fn().mockImplementation((_col: string, val: string) => {
      pendingFilter = { ...pendingFilter, to: val };
      return chain;
    }),
    gte: vi.fn().mockImplementation((_col: string, val: string) => {
      pendingFilter = { ...pendingFilter, from: val };
      // The metrics util awaits the chain — return a thenable that
      // resolves with the filtered set, then resets the in-flight
      // filter so a follow-up readWindow on the same client starts
      // fresh.
      const promise = builder(pendingFilter).then((res) => {
        pendingFilter = {};
        return res;
      });
      return Object.assign(chain, {
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
        finally: promise.finally.bind(promise),
      });
    }),
    // Some readWindow paths skip gte() (when fromDate is null) — the
    // chain itself must be awaitable. We resolve to the lte-filtered
    // set in that case.
    then(onFulfilled: (v: { data: SnapshotRow[]; error: null }) => unknown) {
      return builder(pendingFilter).then((res) => {
        pendingFilter = {};
        return onFulfilled(res);
      });
    },
  };
  return {
    from: vi.fn().mockReturnValue(chain),
  };
}

const SHOP_ID = "shop-test";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("computeChargebackRate", () => {
  it("sums chargebacks ÷ orders across the window and rounds to 1 dp", async () => {
    const rows: SnapshotRow[] = [
      { date: "2026-04-01", order_count: 100, chargeback_count: 1, last_synced_at: "2026-04-02T00:30:00Z" },
      { date: "2026-04-02", order_count: 100, chargeback_count: 0, last_synced_at: "2026-04-03T00:30:00Z" },
      { date: "2026-04-03", order_count: 50,  chargeback_count: 1, last_synced_at: "2026-04-04T00:30:00Z" },
      // Orders outside window are excluded.
      { date: "2026-03-31", order_count: 999, chargeback_count: 99, last_synced_at: "2026-04-01T00:30:00Z" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-01",
      toDate: "2026-04-03",
    });

    expect(r.numerator).toBe(2);
    expect(r.denominator).toBe(250);
    expect(r.rate).toBe(0.8); // 2/250 = 0.8%
    expect(r.available).toBe(true);
    expect(r.daysCovered).toBe(3);
    expect(r.daysExpected).toBe(3);
  });

  it("returns available=false when no snapshot rows cover the window", async () => {
    mockGetServiceClient.mockReturnValue(stubClient([]) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    });

    expect(r.available).toBe(false);
    expect(r.rate).toBeNull();
    expect(r.numerator).toBe(0);
    expect(r.denominator).toBe(0);
    expect(r.daysCovered).toBe(0);
    expect(r.daysExpected).toBe(30);
  });

  it("returns available=true with rate=null when the window has zero orders (avoids 0/0 → NaN)", async () => {
    const rows: SnapshotRow[] = [
      { date: "2026-04-01", order_count: 0, chargeback_count: 0, last_synced_at: "2026-04-02T00:30:00Z" },
      { date: "2026-04-02", order_count: 0, chargeback_count: 0, last_synced_at: "2026-04-03T00:30:00Z" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-01",
      toDate: "2026-04-02",
    });

    expect(r.available).toBe(true);
    expect(r.denominator).toBe(0);
    expect(r.rate).toBeNull();
    expect(r.lowVolume).toBe(true); // 0 < 50
  });

  it("flags low volume when denominator < 50", async () => {
    const rows: SnapshotRow[] = [
      { date: "2026-04-01", order_count: 49, chargeback_count: 0, last_synced_at: "2026-04-02T00:30:00Z" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-01",
      toDate: "2026-04-01",
    });

    expect(r.lowVolume).toBe(true);
    expect(r.rate).toBe(0); // 0/49 = 0%, denominator > 0 so not null
  });

  it("does not flag low volume at the threshold boundary (>= 50)", async () => {
    const rows: SnapshotRow[] = [
      { date: "2026-04-01", order_count: 50, chargeback_count: 0, last_synced_at: "2026-04-02T00:30:00Z" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-01",
      toDate: "2026-04-01",
    });

    expect(r.lowVolume).toBe(false);
  });

  it("computes the period-over-period delta in percentage points", async () => {
    // Current 7d window: 2026-04-08 → 2026-04-14
    //   3 chargebacks, 200 orders → 1.5%
    // Prior 7d window: 2026-04-01 → 2026-04-07
    //   1 chargeback, 200 orders → 0.5%
    // Expected delta: +1.0 pp
    const rows: SnapshotRow[] = [
      // Prior window
      { date: "2026-04-01", order_count: 50, chargeback_count: 0, last_synced_at: "x" },
      { date: "2026-04-04", order_count: 50, chargeback_count: 1, last_synced_at: "x" },
      { date: "2026-04-07", order_count: 100, chargeback_count: 0, last_synced_at: "x" },
      // Current window
      { date: "2026-04-08", order_count: 100, chargeback_count: 1, last_synced_at: "x" },
      { date: "2026-04-11", order_count: 50, chargeback_count: 1, last_synced_at: "x" },
      { date: "2026-04-14", order_count: 50, chargeback_count: 1, last_synced_at: "x" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-08",
      toDate: "2026-04-14",
    });

    expect(r.rate).toBe(1.5);
    expect(r.rateChange).toBe(1); // 1.5 - 0.5 = +1.0 pp
  });

  it("returns rateChange=null when the prior window has no data", async () => {
    // Only current-window data — prior window is empty.
    const rows: SnapshotRow[] = [
      { date: "2026-04-08", order_count: 100, chargeback_count: 1, last_synced_at: "x" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-08",
      toDate: "2026-04-08",
    });

    expect(r.rate).toBe(1); // 1/100 = 1%
    expect(r.rateChange).toBeNull();
  });

  it("uses every row when fromDate is omitted (admin all-time view)", async () => {
    const rows: SnapshotRow[] = [
      { date: "2024-01-01", order_count: 10, chargeback_count: 1, last_synced_at: "x" },
      { date: "2025-06-15", order_count: 90, chargeback_count: 1, last_synced_at: "x" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      toDate: "2026-04-30",
    });

    expect(r.numerator).toBe(2);
    expect(r.denominator).toBe(100);
    expect(r.rate).toBe(2);
    expect(r.rateChange).toBeNull(); // no fromDate ⇒ no prior comparison
  });

  it("surfaces the most recent last_synced_at across rows in the window", async () => {
    const rows: SnapshotRow[] = [
      { date: "2026-04-01", order_count: 100, chargeback_count: 0, last_synced_at: "2026-04-02T00:30:00Z" },
      { date: "2026-04-02", order_count: 100, chargeback_count: 0, last_synced_at: "2026-04-05T15:00:00Z" },
      { date: "2026-04-03", order_count: 100, chargeback_count: 0, last_synced_at: "2026-04-04T12:00:00Z" },
    ];
    mockGetServiceClient.mockReturnValue(stubClient(rows) as never);

    const r = await computeChargebackRate({
      shopId: SHOP_ID,
      fromDate: "2026-04-01",
      toDate: "2026-04-03",
    });

    expect(r.lastSyncedAt).toBe("2026-04-05T15:00:00Z");
  });
});

describe("windowStartDate", () => {
  it("returns the date N-1 days before the toDate (inclusive)", () => {
    expect(windowStartDate("2026-04-30", 30)).toBe("2026-04-01");
    expect(windowStartDate("2026-04-30", 90)).toBe("2026-01-31");
    expect(windowStartDate("2026-04-30", 1)).toBe("2026-04-30");
  });

  it("crosses month and year boundaries correctly", () => {
    expect(windowStartDate("2026-01-05", 10)).toBe("2025-12-27");
  });
});

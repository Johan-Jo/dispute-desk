/**
 * `?view=period` is the Insights page's response: the month record, the trend
 * and the previous month's reasons — and none of the 90-day blocks.
 *
 * Measured on prod 2026-10-03, the full response took 12 s (Mein Maison) and
 * 20 s (blume-box) because it pages every order of the last 90 days twice;
 * the page's own data was about 1 s of that. This pins the lean path: it must
 * never run the order scans, the rail segmentation or the conversion RPC.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/disputes/backfillOrders", () => ({
  classifyScopeGrant: () => null,
  enqueueShopOrdersBackfill: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/insights/railSegmentation", () => ({ railSegmentationFor: vi.fn() }));
vi.mock("@/lib/insights/period/readInsightsPeriod", () => ({ readInsightsPeriod: vi.fn() }));
vi.mock("@/lib/insights/period/readTrend", () => ({ readTrend: vi.fn() }));
vi.mock("@/lib/insights/period/reasonComparison", () => ({ readPreviousReasons: vi.fn() }));
vi.mock("@/lib/insights/period/computeLiveState", () => ({ computeLiveState: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { railSegmentationFor } from "@/lib/insights/railSegmentation";
import { readInsightsPeriod } from "@/lib/insights/period/readInsightsPeriod";
import { readTrend } from "@/lib/insights/period/readTrend";
import { readPreviousReasons } from "@/lib/insights/period/reasonComparison";
import { computeLiveState } from "@/lib/insights/period/computeLiveState";
import { GET } from "@/app/api/dashboard/insights/initial-analysis/route";

const PERIOD = { status: "not_available", periodMonth: "2026-08-01" };
const TREND = [{ periodMonth: "2026-08-01", periodState: "final", cardDisputeRatio: 0.002, cardChargebackCount: 2, cardSettledCount: 995 }];
const PREVIOUS = { periodMonth: "2026-07-01", byReason: [{ reason: "FRAUDULENT", disputes: 1 }] };

function fakeSb(opts: { completedAt?: string; statementRows?: unknown[] } = {}) {
  const tables: string[] = [];
  const ranges: string[] = [];
  const rpc = vi.fn();
  const from = (table: string) => {
    tables.push(table);
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gte", "lt", "not", "in", "order", "limit"]) b[m] = () => b;
    b.range = () => {
      ranges.push(table);
      return Promise.resolve({ data: [], error: null });
    };
    const row =
      table === "shops"
        ? { plan: "starter", historical_import_status: "complete", historical_import_orders_total: 4200, historical_import_since_date: null, historical_import_completed_at: opts.completedAt }
        : table === "shopify_orders"
          ? { created_at_shopify: "2025-01-01T00:00:00Z" }
          : null;
    b.single = () => Promise.resolve({ data: row, error: null });
    b.maybeSingle = () => Promise.resolve({ data: row, error: null });
    b.then = (resolve: (r: unknown) => void) =>
      resolve({ data: table === "ratio_snapshots" ? (opts.statementRows ?? []) : [], error: null, count: 0 });
    return b;
  };
  vi.mocked(getServiceClient).mockReturnValue({ from, rpc } as never);
  return { tables, ranges, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readInsightsPeriod).mockResolvedValue(PERIOD as never);
  vi.mocked(readTrend).mockResolvedValue(TREND as never);
  vi.mocked(readPreviousReasons).mockResolvedValue(PREVIOUS as never);
});

describe("GET /api/dashboard/insights/initial-analysis?view=period", () => {
  it("returns what the page renders", async () => {
    fakeSb();
    const res = await GET(new NextRequest("https://x.test/api/dashboard/insights/initial-analysis?view=period&period=2026-08"));
    expect(await res.json()).toEqual({
      historicalImportStatus: "complete",
      historicalImportOrdersTotal: 4200,
      period: PERIOD,
      trend: TREND,
      liveState: null,
      previousReasons: PREVIOUS,
      recordsPending: false,
    });
    expect(vi.mocked(readPreviousReasons).mock.calls[0]![2]).toBe("2026-08-01");
    expect(res.headers.get("Server-Timing")).toMatch(/^insights;dur=\d+$/);
  });

  it("runs none of the 90-day work", async () => {
    const sb = fakeSb();
    await GET(new NextRequest("https://x.test/api/dashboard/insights/initial-analysis?view=period"));
    expect(sb.ranges).toEqual([]); // no paged order scan
    expect(sb.rpc).not.toHaveBeenCalled(); // no all-time conversion aggregate
    expect(railSegmentationFor).not.toHaveBeenCalled();
    expect(computeLiveState).not.toHaveBeenCalled();
    expect(sb.tables).not.toContain("shop_fraud_daily_metrics");
    expect(sb.tables).not.toContain("shop_daily_metrics");
    expect(sb.tables).not.toContain("shop_sessions"); // scopes are the banner's, not the page's
  });

  it("still serves the trend when the reasons read fails", async () => {
    fakeSb();
    vi.mocked(readPreviousReasons).mockRejectedValue(new Error("db"));
    const res = await GET(new NextRequest("https://x.test/api/dashboard/insights/initial-analysis?view=period"));
    const body = await res.json();
    expect(body.previousReasons).toBeNull();
    expect(body.trend).toEqual(TREND);
  });

  // A new shop between "import complete" and "month records written"
  // (whj8db-1q, 2026-10-09: an empty chart for the whole first day).
  describe("recordsPending", () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const get = () => GET(new NextRequest("https://x.test/api/dashboard/insights/initial-analysis?view=period"));

    it("is true while the import is complete, recent, and the statement month has no record", async () => {
      const sb = fakeSb({ completedAt: hoursAgo(1) });
      const body = await (await get()).json();
      expect(body.recordsPending).toBe(true);
      // The live statement-month compute is not run for a page that shows a card.
      expect(readInsightsPeriod).not.toHaveBeenCalled();
      expect(body.period.status).toBe("not_available");
      expect(sb.tables.filter((t) => t !== "shops" && t !== "ratio_snapshots" && t !== "shopify_orders")).toEqual([]);
    });

    it("is false once the statement month has a record of any coverage", async () => {
      fakeSb({ completedAt: hoursAgo(1), statementRows: [{ period_month: "2026-09-01", coverage: "partial" }] });
      const body = await (await get()).json();
      expect(body.recordsPending).toBe(false);
      expect(readInsightsPeriod).toHaveBeenCalled();
    });

    it("is false 49 hours after the import, so the page can never be held for good", async () => {
      const sb = fakeSb({ completedAt: hoursAgo(49) });
      const body = await (await get()).json();
      expect(body.recordsPending).toBe(false);
      expect(sb.tables).not.toContain("ratio_snapshots");
    });

    it("is false while the import is still running", async () => {
      fakeSb({});
      const body = await (await get()).json();
      expect(body.recordsPending).toBe(false);
    });
  });
});

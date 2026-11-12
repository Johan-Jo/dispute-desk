/**
 * Defence Package admin queries: the 7-day stats must page past PostgREST's
 * 1000-row cap and fail loudly (not "0 runs, 0% OK"), and the runs list must
 * carry the merchant labels AdminMerchant renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let runsPages: Array<{ data: Row[] | null; error: { message: string } | null }> = [];
let pageCall = 0;
let listRows: Row[] = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "gte", "order", "in"]) chain[m] = () => chain;
      if (table === "shops") {
        chain.then = (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: [{ id: "shop-1", shop_domain: "x1.myshopify.com", primary_domain: "store.example" }],
            error: null,
          }).then(res);
        return chain;
      }
      chain.range = () => Promise.resolve(runsPages[pageCall++] ?? { data: [], error: null });
      chain.limit = () => Promise.resolve({ data: listRows, error: null });
      return chain;
    },
  }),
}));

import { getDashboardStats, listRecentRuns } from "@/lib/defence/admin-queries";

const run = (id: number, status = "ok"): Row => ({
  id: String(id),
  validation_status: status,
  prompt_tokens: 100,
  completion_tokens: 50,
  duration_ms: 1000,
});

beforeEach(() => {
  pageCall = 0;
  runsPages = [];
  listRows = [];
});

describe("getDashboardStats", () => {
  it("counts every run, not just the first 1000", async () => {
    runsPages = [
      { data: Array.from({ length: 1000 }, (_, i) => run(i)), error: null },
      { data: Array.from({ length: 250 }, (_, i) => run(1000 + i, "failed")), error: null },
    ];
    const stats = await getDashboardStats();
    expect(stats.totalRuns7d).toBe(1250);
    expect(stats.failedCount7d).toBe(250);
    expect(stats.okRate7d).toBe(80);
  });

  it("throws on a failed read instead of reporting zeros", async () => {
    runsPages = [{ data: null, error: { message: "boom" } }];
    await expect(getDashboardStats()).rejects.toThrow("boom");
  });
});

describe("listRecentRuns", () => {
  it("attaches merchant labels", async () => {
    listRows = [
      { id: "r1", shop_id: "shop-1", package_id: null, created_at: "2026-11-12T00:00:00Z" },
      { id: "r2", shop_id: null, package_id: null, created_at: "2026-11-12T00:00:00Z" },
    ];
    const rows = await listRecentRuns(10);
    expect(rows[0].shop).toEqual({ shop_domain: "x1.myshopify.com", primary_domain: "store.example" });
    expect(rows[1].shop).toBeNull();
  });
});

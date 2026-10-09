/**
 * The calculate-ratios cron: one `maintainShopMonths` call per shop, under a
 * fair share of the time budget. The routine itself is covered in
 * lib/insights/period/__tests__/maintainShopMonths.test.ts.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/insights/period/computeShopMonth", () => ({ computeShopMonth: vi.fn() }));
vi.mock("@/lib/insights/period/persistShopMonth", () => ({ persistShopMonth: vi.fn(), METRICS_VERSION: 4 }));
vi.mock("@/lib/email/adminEmail", () => ({ sendAdminEmail: vi.fn() }));
vi.mock("@/lib/disputes/backfillShopDailyMetrics", () => ({ enqueueShopDailyMetricsBackfill: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { computeShopMonth } from "@/lib/insights/period/computeShopMonth";
import { persistShopMonth } from "@/lib/insights/period/persistShopMonth";
import { GET } from "@/app/api/cron/calculate-ratios/route";
import {
  SHOP,
  WINDOW_12,
  computed,
  fakeClient,
  makeWorld,
  record,
  syncJob,
  type World,
} from "@/lib/insights/period/__tests__/fixtures/maintainWorld";

const mockCompute = vi.mocked(computeShopMonth);
const mockPersist = vi.mocked(persistShopMonth);

const run = async (world: World) => {
  vi.mocked(getServiceClient).mockReturnValue(fakeClient(world));
  const res = await GET(
    new Request("https://x.test/api/cron/calculate-ratios", { headers: { authorization: "Bearer s" } }) as never,
  );
  return (await res.json()) as { results: Array<Record<string, unknown>> };
};

const persisted = () => mockPersist.mock.calls.map((c) => `${c[1].shopId}:${c[1].month}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
  process.env.CRON_ENABLED = "true";
  process.env.CRON_SECRET = "s";
  mockCompute.mockImplementation(async (_sb, _shop, month) => computed(month));
  mockPersist.mockResolvedValue({ changed: true, revision: 1, stableAt: null });
});
afterEach(() => vi.useRealTimers());

describe("calculate-ratios cron", () => {
  it("never writes the current, unfinished month, and writes last month first", async () => {
    const world = makeWorld({
      shops: [SHOP],
      firstOrder: "2026-07-14T00:00:00Z",
      records: [record("2026-08-01")],
    });
    await run(world);
    expect(persisted()).not.toContain("s1:2026-10-01");
    expect(persisted()[0]).toBe("s1:2026-09-01");
  });

  it("skips a shop with no record whose disputes have not synced", async () => {
    const world = makeWorld({ shops: [SHOP], firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("failed")] });
    const body = await run(world);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(body.results).toEqual([{ shop: SHOP.shop_domain, skipped: "not_ready" }]);
  });

  it("after a metrics-version bump every shop still gets its statement month the same night", async () => {
    const shops = Array.from({ length: 6 }, (_, i) => ({ ...SHOP, id: `s${i + 1}`, shop_domain: `shop-${i + 1}.myshopify.com` }));
    const world = makeWorld({
      shops,
      firstOrder: "2020-01-01T00:00:00Z",
      // Every shop: 12 months on the previous version → 11 heals each.
      records: shops.flatMap((s) => WINDOW_12.map((m) => record(m, { shop_id: s.id, metrics_version: 3 }))),
    });
    // 6 s per month: 6 shops × 12 months = 432 s, more than the 240 s budget.
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      vi.setSystemTime(Date.now() + 6_000);
      return computed(month);
    });
    const body = await run(world);
    for (const s of shops) expect(persisted()).toContain(`${s.id}:2026-09-01`);
    // …and no shop was dropped for time.
    expect(body.results.some((r) => r.skipped === "time_budget")).toBe(false);
    // The older months are spread over later nights instead.
    expect(body.results.every((r) => (r.remaining as number) > 0)).toBe(true);
  });

  it("hands a first materialization it could not finish to the job", async () => {
    const world = makeWorld({ shops: [SHOP], firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    mockPersist.mockImplementation(async (_sb, a) => {
      world.records.push(record(a.month));
      return { changed: true, revision: 0, stableAt: "2026-10-02T02:00:00Z" };
    });
    // 30 s per month against a 240 s budget: the window does not fit.
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      vi.setSystemTime(Date.now() + 30_000);
      return computed(month);
    });
    const body = await run(world);
    expect(persisted()).not.toContain("s1:2026-09-01");
    expect(world.jobs.filter((j) => j.job_type === "materialize_insights_months")).toEqual([
      expect.objectContaining({ shop_id: "s1", status: "queued", priority: 95 }),
    ]);
    expect(body.results[0]).toMatchObject({ handedOff: true });
  });

  it("does not enqueue the job for an established shop with months left to heal", async () => {
    const world = makeWorld({
      shops: [SHOP],
      firstOrder: "2020-01-01T00:00:00Z",
      records: [record("2026-08-01"), record("2026-09-01")],
    });
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      vi.setSystemTime(Date.now() + 100_000);
      return computed(month);
    });
    const body = await run(world);
    expect(body.results[0]!.remaining).toBeGreaterThan(0);
    expect(world.jobs).toEqual([]);
  });
});

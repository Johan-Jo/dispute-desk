import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/insights/period/computeShopMonth", () => ({ computeShopMonth: vi.fn() }));
vi.mock("@/lib/insights/period/persistShopMonth", () => ({ persistShopMonth: vi.fn(), METRICS_VERSION: 3 }));
vi.mock("@/lib/email/adminEmail", () => ({ sendAdminEmail: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { computeShopMonth } from "@/lib/insights/period/computeShopMonth";
import { persistShopMonth } from "@/lib/insights/period/persistShopMonth";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { GET } from "@/app/api/cron/calculate-ratios/route";

const mockCompute = vi.mocked(computeShopMonth);
const mockPersist = vi.mocked(persistShopMonth);
const mockEmail = vi.mocked(sendAdminEmail);

const SHOP = {
  id: "s1", shop_domain: "blume-box.myshopify.com", historical_import_status: "complete",
  historical_import_completed_at: "2026-07-21T00:00:00Z", historical_import_since_date: null,
};

function world(opts: { rows: Array<Record<string, unknown>>; firstOrder: string; alertInserted?: boolean }) {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: { created_at_shopify: opts.firstOrder }, error: null });
    b.upsert = () => ({
      select: async () => ({ data: opts.alertInserted ? [{ id: "a" }] : [], error: null }),
    });
    b.then = (resolve: (r: unknown) => void) =>
      resolve(table === "shops" ? { data: [SHOP], error: null } : { data: opts.rows, error: null });
    return b;
  };
  mockClient().mockReturnValue({ from } as never);
}
const mockClient = () => vi.mocked(getServiceClient);

const block = (month: string, cb = 1) =>
  ({ programme: { periodMonth: month, cardChargebackCount: cb, visaChargebackCount: cb, mcChargebackCount: 0, cardDisputeRatio: 0.001, ecmRatio: 0, cardFramingApplies: true }, operational: {}, checkpoints: [] }) as never;
const finalRow = (month: string, cb = 1) => ({
  period_month: month, stable_at: "2026-01-01T00:00:00Z", metrics_version: 3, coverage: "full",
  card_chargeback_count: cb, visa_chargeback_count: cb, mc_chargeback_count: 0,
  card_dispute_ratio: 0.001, mc_ecm_ratio: 0, card_framing_applies: true,
});

const run = () =>
  GET(new Request("https://x.test/api/cron/calculate-ratios", { headers: { authorization: "Bearer s" } }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_ENABLED = "true";
  process.env.CRON_SECRET = "s";
  mockCompute.mockImplementation(async (_sb, _shop, month) => block(month));
  mockPersist.mockResolvedValue({ changed: true, revision: 1, stableAt: null });
});
afterEach(() => vi.useRealTimers());

const persistedMonths = () => mockPersist.mock.calls.map((c) => c[1].month);

describe("calculate-ratios cron", () => {
  it("never writes the current, unfinished month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
    world({ rows: [], firstOrder: "2026-08-14T00:00:00Z" });
    await run();
    expect(persistedMonths()).not.toContain("2026-10-01");
    expect(persistedMonths()[0]).toBe("2026-09-01");
  });

  it("self-heals at most 3 missing months per run, oldest first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
    world({ rows: [], firstOrder: "2020-01-01T00:00:00Z" });
    await run();
    expect(persistedMonths()).toEqual(["2026-09-01", "2025-10-01", "2025-11-01", "2025-12-01"]);
  });

  it("a zero-dispute shop's 12 months fill within 4 nights", async () => {
    const rows: Array<Record<string, unknown>> = [];
    mockPersist.mockImplementation(async (_sb, a) => {
      rows.push(finalRow(a.month, 0));
      return { changed: true, revision: 0, stableAt: "2026-10-09T00:00:00Z" };
    });
    vi.useFakeTimers();
    for (const day of ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]) {
      vi.setSystemTime(new Date(`${day}T02:00:00Z`));
      world({ rows: [...rows], firstOrder: "2020-01-01T00:00:00Z" });
      await run();
    }
    const months = new Set(rows.map((r) => r.period_month));
    expect(months.size).toBe(12);
  });

  it("revises a final month only on a material change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
    const rows = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 9 + i, 1)).toISOString().slice(0, 10);
      return finalRow(d);
    });
    world({ rows, firstOrder: "2020-01-01T00:00:00Z" });
    mockCompute.mockImplementation(async (_sb, _shop, month) => block(month, month === "2026-07-01" ? 2 : 1));
    await run();
    // Sep (nightly) + Jul (a new chargeback). Aug unchanged → no write.
    expect(persistedMonths()).toEqual(["2026-09-01", "2026-07-01"]);
    expect(mockPersist.mock.calls[1]![1].reason).toBe("late_data");
  });

  it("emails ops once when last month is still not final on the 9th", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));
    world({ rows: [], firstOrder: "2026-09-01T00:00:00Z", alertInserted: true });
    await run();
    expect(mockEmail).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    mockCompute.mockImplementation(async (_sb, _shop, month) => block(month));
    mockPersist.mockResolvedValue({ changed: false, revision: 1, stableAt: null });
    world({ rows: [], firstOrder: "2026-09-01T00:00:00Z", alertInserted: false });
    await run();
    expect(mockEmail).not.toHaveBeenCalled();
  });
});

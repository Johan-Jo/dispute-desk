/**
 * `maintainShopMonths` and its first-materialization check
 * (docs/plans/insights-first-day-gaps.plan.md §3.1–§3.2).
 *
 * The case behind it: whj8db-1q installed on 2026-10-09, finished its order
 * import and synced 481 disputes within the hour, and showed an empty chart
 * because month records were only written by the 02:00 cron, three months a
 * night.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/insights/period/computeShopMonth", () => ({ computeShopMonth: vi.fn() }));
vi.mock("@/lib/insights/period/persistShopMonth", () => ({ persistShopMonth: vi.fn(), METRICS_VERSION: 4 }));
vi.mock("@/lib/email/adminEmail", () => ({ sendAdminEmail: vi.fn() }));
vi.mock("@/lib/disputes/backfillShopDailyMetrics", () => ({ enqueueShopDailyMetricsBackfill: vi.fn() }));

import { computeShopMonth } from "@/lib/insights/period/computeShopMonth";
import { persistShopMonth } from "@/lib/insights/period/persistShopMonth";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { enqueueShopDailyMetricsBackfill } from "@/lib/disputes/backfillShopDailyMetrics";
import { canMaterializeFirst } from "../firstMaterialization";
import { maintainShopMonths } from "../maintainShopMonths";
import { SHOP, WINDOW_12, computed, fakeClient, makeWorld, record, syncJob, type World } from "./fixtures/maintainWorld";

const mockCompute = vi.mocked(computeShopMonth);
const mockPersist = vi.mocked(persistShopMonth);
const mockEmail = vi.mocked(sendAdminEmail);
const mockDaily = vi.mocked(enqueueShopDailyMetricsBackfill);

const BIG = 10 * 60_000;
const written = () => mockPersist.mock.calls.map((c) => c[1].month);

/** `persistShopMonth` that stores the row, so a second call sees it. */
function persistInto(world: World, stableAt: string | null = "2026-10-09T12:00:00Z") {
  mockPersist.mockImplementation(async (_sb, a) => {
    if (!world.records.some((r) => r.period_month === a.month)) {
      world.records.push(record(a.month, { stable_at: stableAt }));
    }
    return { changed: true, revision: 0, stableAt };
  });
}

/** Each compute takes `ms` of (fake) wall time, so a budget can run out. */
function slowCompute(ms: number) {
  mockCompute.mockImplementation(async (_sb, _shop, month) => {
    vi.setSystemTime(Date.now() + ms);
    return computed(month);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
  mockCompute.mockImplementation(async (_sb, _shop, month) => computed(month));
  mockPersist.mockResolvedValue({ changed: true, revision: 0, stableAt: "2026-10-09T12:00:00Z" });
  mockDaily.mockResolvedValue("job-daily");
});
afterEach(() => vi.useRealTimers());

describe("canMaterializeFirst", () => {
  const at = (iso: string) => new Date(iso);

  it("waits for the order import", async () => {
    const world = makeWorld({ jobs: [syncJob("succeeded")] });
    const shop = { ...SHOP, historical_import_status: "in_progress", historical_import_completed_at: null };
    expect(await canMaterializeFirst(fakeClient(world), shop, at("2026-10-09T12:00:00Z"))).toEqual({ ok: false, reason: "import" });
  });

  it("waits for a dispute sync that succeeded — a failed one does not count", async () => {
    expect(await canMaterializeFirst(fakeClient(makeWorld()), SHOP, at("2026-10-09T12:00:00Z"))).toEqual({ ok: false, reason: "disputes" });
    const failedOnly = makeWorld({ jobs: [syncJob("failed"), syncJob("failed"), syncJob("queued")] });
    expect(await canMaterializeFirst(fakeClient(failedOnly), SHOP, at("2026-10-09T12:00:00Z"))).toEqual({ ok: false, reason: "disputes" });
  });

  it("is ready once one sync succeeded", async () => {
    const world = makeWorld({ jobs: [syncJob("failed"), syncJob("succeeded")] });
    expect(await canMaterializeFirst(fakeClient(world), SHOP, at("2026-10-09T12:00:00Z"))).toEqual({ ok: true });
  });

  it("is forced after 24 hours without a successful sync, and only then", async () => {
    const later = at("2026-10-10T11:00:01Z"); // 25 h after the import completed
    expect(await canMaterializeFirst(fakeClient(makeWorld({ jobs: [syncJob("failed")] })), SHOP, later)).toEqual({ ok: true, forced: true });
    // A healthy shop that is merely picked up late is not "forced".
    expect(await canMaterializeFirst(fakeClient(makeWorld({ jobs: [syncJob("succeeded")] })), SHOP, later)).toEqual({ ok: true });
  });
});

describe("maintainShopMonths — a shop with no record yet", () => {
  it("writes nothing until the disputes have synced, and raises no day-9 alert", async () => {
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));
    const world = makeWorld({ firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("failed")] });
    const r = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(r.skipped).toBe("not_ready");
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockDaily).not.toHaveBeenCalled();
    expect(world.alerts).toEqual([]);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it("writes the whole window oldest first, the statement month last", async () => {
    const world = makeWorld({ firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    persistInto(world);
    const order: string[] = [];
    mockDaily.mockImplementation(async () => {
      order.push("daily-metrics");
      return "job-daily";
    });
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      order.push(month);
      return computed(month);
    });

    const r = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });

    // September is computed after August exists, so it can read August's
    // stored median (the fulfilment-baseline checkpoint).
    expect(written()).toEqual(WINDOW_12);
    expect(order[0]).toBe("daily-metrics");
    expect(mockDaily).toHaveBeenCalledWith("s1", { force: true });
    expect(mockPersist.mock.calls.every((c) => c[1].reason === "materialize")).toBe(true);
    expect(r).toMatchObject({ remaining: 0, statementRecorded: true });
    expect(world.alerts).toEqual([]);
  });

  it("cut by the budget: the statement month waits, and the next call writes it once", async () => {
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z")); // the 10th: day-9 alert territory
    const world = makeWorld({ firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    persistInto(world);
    slowCompute(6_000);

    const first = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: 20_000 });
    expect(first.written).toEqual(WINDOW_12.slice(0, 4));
    expect(first).toMatchObject({ remaining: 8, statementRecorded: false });
    // A first materialization still in progress is not "a month that failed
    // to become final".
    expect(world.alerts).toEqual([]);

    const second = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(second.written).toEqual(WINDOW_12.slice(4));
    expect(second).toMatchObject({ remaining: 0, statementRecorded: true });
    expect(written().filter((m) => m === "2026-09-01")).toHaveLength(1);
    // The daily-metrics backfill belongs to the first write only.
    expect(mockDaily).toHaveBeenCalledTimes(1);
  });

  it("a write that throws after 3 months leaves exactly one daily-metrics backfill behind", async () => {
    const world = makeWorld({ firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    persistInto(world);
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      if (month === WINDOW_12[3]) throw new Error("boom");
      return computed(month);
    });
    await expect(maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG })).rejects.toThrow("boom");
    expect(world.records).toHaveLength(3);

    mockCompute.mockImplementation(async (_sb, _shop, month) => computed(month));
    const retry = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(retry.remaining).toBe(0);
    expect(world.records).toHaveLength(12);
    expect(mockDaily).toHaveBeenCalledTimes(1);
  });

  it("forced after 24 hours without a sync: writes, one alert, one email", async () => {
    vi.setSystemTime(new Date("2026-10-11T02:00:00Z"));
    const world = makeWorld({ firstOrder: "2026-09-03T00:00:00Z", jobs: [syncJob("failed")] });
    persistInto(world);
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(written()).toEqual(["2026-09-01"]);
    expect(world.alerts).toEqual([{ shop_id: "s1", alert_key: "first_records_forced", period_month: "2026-09-01" }]);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockEmail.mock.calls[0]![0].text).toContain("must be recomputed");
  });

  it("an empty trend window still gets its statement month", async () => {
    // First order this month: no closed month has orders.
    const world = makeWorld({ firstOrder: "2026-10-03T00:00:00Z", jobs: [syncJob("succeeded")] });
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(written()).toEqual(["2026-09-01"]);
  });
});

describe("maintainShopMonths — a shop that already has records", () => {
  it("is never held by the first-materialization check", async () => {
    // One record, no successful sync job at all.
    const world = makeWorld({ firstOrder: "2026-08-10T00:00:00Z", records: [record("2026-08-01")] });
    const r = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(r.skipped).toBeUndefined();
    expect(written()).toEqual(["2026-09-01"]);
    expect(mockDaily).not.toHaveBeenCalled();
  });

  it("writes the statement month first, so a heal that throws cannot cost it", async () => {
    const world = makeWorld({ firstOrder: "2020-01-01T00:00:00Z", records: [record("2026-08-01")] });
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      if (month === "2025-10-01") throw new Error("boom");
      return computed(month);
    });
    await expect(maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG })).rejects.toThrow("boom");
    expect(written()).toEqual(["2026-09-01"]);
  });

  it("on the 1st of a month the new statement month is written first", async () => {
    vi.setSystemTime(new Date("2026-11-01T02:00:00Z"));
    const world = makeWorld({
      firstOrder: "2026-08-10T00:00:00Z",
      records: [record("2026-08-01"), record("2026-09-01")],
    });
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(written()[0]).toBe("2026-10-01");
    expect(mockPersist.mock.calls[0]![1].reason).toBe("materialize");
  });

  it("a predecessor on an old metrics version still counts as on record", async () => {
    const world = makeWorld({
      firstOrder: "2026-08-10T00:00:00Z",
      records: [record("2026-08-01", { metrics_version: 3 }), record("2026-09-01", { metrics_version: 3 })],
    });
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(written()).toEqual(["2026-09-01", "2026-08-01"]);
  });

  it("heals every missing month in one run — no cap of 3", async () => {
    const world = makeWorld({
      firstOrder: "2020-01-01T00:00:00Z",
      records: [record("2026-08-01"), record("2026-09-01")],
    });
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(written()).toEqual(["2026-09-01", ...WINDOW_12.slice(0, 10)]);
  });

  it("revises a final month only on a material change", async () => {
    vi.setSystemTime(new Date("2026-10-02T02:00:00Z"));
    const world = makeWorld({ firstOrder: "2020-01-01T00:00:00Z", records: WINDOW_12.map((m) => record(m)) });
    mockCompute.mockImplementation(async (_sb, _shop, month) => computed(month, month === "2026-07-01" ? 2 : 1));
    const r = await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    // Sep (nightly) + Jul (a new chargeback). Aug unchanged → no write.
    expect(written()).toEqual(["2026-09-01", "2026-07-01"]);
    expect(mockPersist.mock.calls[1]![1].reason).toBe("late_data");
    expect(r.written).toEqual(["2026-09-01"]);
    expect(r.revised).toContain("2026-07-01");
  });

  it("emails ops once when the statement month is still not final on the 9th", async () => {
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));
    const world = makeWorld({
      firstOrder: "2026-08-10T00:00:00Z",
      records: [record("2026-08-01"), record("2026-09-01", { stable_at: null })],
    });
    mockPersist.mockResolvedValue({ changed: true, revision: 1, stableAt: null });
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(mockEmail).toHaveBeenCalledTimes(1);
    await maintainShopMonths(fakeClient(world), SHOP, new Date(), { budgetMs: BIG });
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(world.alerts.map((a) => a.alert_key)).toEqual(["m1_not_stable"]);
  });
});

/**
 * `materialize_insights_months` and the helper that enqueues it
 * (docs/plans/insights-first-day-gaps.plan.md §3.3).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/insights/period/computeShopMonth", () => ({ computeShopMonth: vi.fn() }));
vi.mock("@/lib/insights/period/persistShopMonth", () => ({ persistShopMonth: vi.fn(), METRICS_VERSION: 4 }));
vi.mock("@/lib/email/adminEmail", () => ({ sendAdminEmail: vi.fn() }));
vi.mock("@/lib/disputes/backfillShopDailyMetrics", () => ({ enqueueShopDailyMetricsBackfill: vi.fn() }));
vi.mock("@/lib/disputes/syncDisputes", () => ({ syncDisputes: vi.fn() }));
vi.mock("@/lib/disputes/snapshotFraudDailyMetrics", () => ({ backfillFraudDailyMetrics: vi.fn() }));
vi.mock("@/lib/email/triggerOnboardingDigest", () => ({ triggerOnboardingDigest: vi.fn() }));
vi.mock("@/lib/billing/replayBlockedBuilds", () => ({ scheduleBlockedBuildReplay: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { computeShopMonth } from "@/lib/insights/period/computeShopMonth";
import { persistShopMonth } from "@/lib/insights/period/persistShopMonth";
import { sendAdminEmail } from "@/lib/email/adminEmail";
import { enqueueShopDailyMetricsBackfill } from "@/lib/disputes/backfillShopDailyMetrics";
import { syncDisputes } from "@/lib/disputes/syncDisputes";
import { enqueueMaterializeInsightsMonths } from "@/lib/insights/period/enqueueMaterialize";
import { enqueueFirstDisputeSync } from "@/lib/disputes/backfillOrders";
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
import { handleMaterializeInsightsMonths } from "../materializeInsightsMonthsJob";
import { handleSyncDisputes } from "../syncDisputesJob";
import { handleBackfillFraudDailyMetrics } from "../backfillFraudDailyMetricsJob";
import type { ClaimedJob } from "../../claimJobs";

const mockCompute = vi.mocked(computeShopMonth);
const mockPersist = vi.mocked(persistShopMonth);
const mockEmail = vi.mocked(sendAdminEmail);
const mockDaily = vi.mocked(enqueueShopDailyMetricsBackfill);

const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "j1",
  shopId: "s1",
  jobType: "materialize_insights_months",
  entityId: "s1",
  attempts: 1,
  maxAttempts: 3,
  ...over,
});

const use = (world: World) => vi.mocked(getServiceClient).mockReturnValue(fakeClient(world));
const materializeJobs = (world: World) => world.jobs.filter((j) => j.job_type === "materialize_insights_months");

function persistInto(world: World) {
  mockPersist.mockImplementation(async (_sb, a) => {
    world.records.push(record(a.month));
    return { changed: true, revision: 0, stableAt: "2026-10-09T12:00:00Z" };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
  mockCompute.mockImplementation(async (_sb, _shop, month) => computed(month));
  mockDaily.mockResolvedValue("job-daily");
});
afterEach(() => vi.useRealTimers());

describe("handleMaterializeInsightsMonths", () => {
  it("not ready: writes nothing and enqueues nothing", async () => {
    const world = makeWorld({ shops: [SHOP], firstOrder: "2020-01-01T00:00:00Z" });
    use(world);
    await handleMaterializeInsightsMonths(job());
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockDaily).not.toHaveBeenCalled();
    expect(world.jobs).toEqual([]);
  });

  it("ready: 12 records, one daily-metrics backfill, no continuation", async () => {
    const world = makeWorld({ shops: [SHOP], firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    use(world);
    persistInto(world);
    await handleMaterializeInsightsMonths(job());
    expect(world.records.map((r) => r.period_month)).toEqual(WINDOW_12);
    expect(mockDaily).toHaveBeenCalledTimes(1);
    expect(materializeJobs(world)).toEqual([]);
  });

  it("a slice cut by its budget enqueues its own continuation, which finishes", async () => {
    const world = makeWorld({ shops: [SHOP], firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    use(world);
    persistInto(world);
    mockCompute.mockImplementation(async (_sb, _shop, month) => {
      vi.setSystemTime(Date.now() + 30_000);
      return computed(month);
    });
    // The running job itself is in the table, as it is in production: the
    // continuation must not be deduped against it.
    world.jobs.push({ shop_id: "s1", job_type: "materialize_insights_months", status: "running" });

    await handleMaterializeInsightsMonths(job());
    expect(world.records).toHaveLength(4);
    expect(materializeJobs(world).filter((j) => j.status === "queued")).toHaveLength(1);

    mockCompute.mockImplementation(async (_sb, _shop, month) => computed(month));
    await handleMaterializeInsightsMonths(job({ id: "j2" }));
    expect(world.records).toHaveLength(12);
    expect(materializeJobs(world).filter((j) => j.status === "queued")).toHaveLength(1);
    expect(mockDaily).toHaveBeenCalledTimes(1);
  });

  it("alerts ops once when the last attempt fails, and still fails the job", async () => {
    const world = makeWorld({ shops: [SHOP], firstOrder: "2020-01-01T00:00:00Z", jobs: [syncJob("succeeded")] });
    use(world);
    mockCompute.mockRejectedValue(new Error("boom"));

    await expect(handleMaterializeInsightsMonths(job({ attempts: 2 }))).rejects.toThrow("boom");
    expect(world.alerts).toEqual([]);

    await expect(handleMaterializeInsightsMonths(job({ attempts: 3 }))).rejects.toThrow("boom");
    await expect(handleMaterializeInsightsMonths(job({ id: "j9", attempts: 3 }))).rejects.toThrow("boom");
    expect(world.alerts).toEqual([{ shop_id: "s1", alert_key: "materialize_failed", period_month: "2026-09-01" }]);
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an uninstalled shop", async () => {
    const world = makeWorld({ shops: [{ ...SHOP, uninstalled_at: "2026-10-09T11:00:00Z" }], jobs: [syncJob("succeeded")] });
    use(world);
    await handleMaterializeInsightsMonths(job());
    expect(mockPersist).not.toHaveBeenCalled();
  });
});

describe("enqueueMaterializeInsightsMonths", () => {
  it("enqueues for a shop with a complete import and no record", async () => {
    const world = makeWorld({ shops: [SHOP] });
    use(world);
    expect(await enqueueMaterializeInsightsMonths("s1")).not.toBeNull();
    expect(materializeJobs(world)).toEqual([
      expect.objectContaining({ shop_id: "s1", status: "queued", priority: 95 }),
    ]);
    // One queued is enough.
    expect(await enqueueMaterializeInsightsMonths("s1")).toBeNull();
    expect(materializeJobs(world)).toHaveLength(1);
  });

  it("does nothing for a shop that has records, or whose import is not complete", async () => {
    const withRecords = makeWorld({ shops: [SHOP], records: [record("2026-09-01")] });
    use(withRecords);
    expect(await enqueueMaterializeInsightsMonths("s1")).toBeNull();
    expect(withRecords.reads).toEqual(["ratio_snapshots"]); // one count, nothing else

    const importing = makeWorld({ shops: [{ ...SHOP, historical_import_status: "in_progress" }] });
    use(importing);
    expect(await enqueueMaterializeInsightsMonths("s1")).toBeNull();
    expect(importing.jobs).toEqual([]);
  });

  it("never throws", async () => {
    vi.mocked(getServiceClient).mockImplementation(() => {
      throw new Error("no db");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await enqueueMaterializeInsightsMonths("s1")).toBeNull();
    warn.mockRestore();
  });
});

describe("the events that enqueue it", () => {
  it("a dispute sync that succeeded enqueues it; one that reported errors does not", async () => {
    const world = makeWorld({ shops: [SHOP] });
    use(world);
    vi.mocked(syncDisputes).mockResolvedValue({ errors: [] } as never);
    await handleSyncDisputes(job({ jobType: "sync_disputes" }));
    expect(materializeJobs(world)).toHaveLength(1);

    const failing = makeWorld({ shops: [SHOP] });
    use(failing);
    vi.mocked(syncDisputes).mockResolvedValue({ errors: ["401"] } as never);
    await expect(handleSyncDisputes(job({ jobType: "sync_disputes" }))).rejects.toThrow();
    expect(failing.jobs).toEqual([]);
  });

  it("the fraud rollup finishing enqueues it, and a failing enqueue does not fail the rollup", async () => {
    const world = makeWorld({ shops: [SHOP] });
    use(world);
    await handleBackfillFraudDailyMetrics(job({ jobType: "backfill_fraud_daily_metrics" }));
    expect(materializeJobs(world)).toHaveLength(1);

    vi.mocked(getServiceClient).mockImplementation(() => {
      throw new Error("no db");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(handleBackfillFraudDailyMetrics(job({ jobType: "backfill_fraud_daily_metrics" }))).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("import completion starts the first dispute sync only with a session and none before", async () => {
    const offline = { shop_id: "s1", session_type: "offline" };
    const syncs = (w: World) => w.jobs.filter((j) => j.job_type === "sync_disputes");

    const fresh = makeWorld({ shops: [SHOP], sessions: [offline] });
    use(fresh);
    await enqueueFirstDisputeSync("s1");
    expect(syncs(fresh)).toEqual([expect.objectContaining({ shop_id: "s1", status: "queued", priority: 50 })]);
    await enqueueFirstDisputeSync("s1");
    expect(syncs(fresh)).toHaveLength(1);

    const noSession = makeWorld({ shops: [SHOP] });
    use(noSession);
    await enqueueFirstDisputeSync("s1");
    expect(noSession.jobs).toEqual([]);

    const alreadySynced = makeWorld({ shops: [SHOP], sessions: [offline], jobs: [syncJob("succeeded")] });
    use(alreadySynced);
    await enqueueFirstDisputeSync("s1");
    expect(syncs(alreadySynced)).toHaveLength(1);
  });
});

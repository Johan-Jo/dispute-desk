/**
 * The worker claims again while its start budget lasts.
 *
 * `claim_jobs` returns at most one job per shop per call, so a single claim
 * per tick drained a one-shop backlog at one job every 2 minutes (prod,
 * 2026-10-09: a defence build waited 54 minutes for ~30 s of work).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const claimJobs = vi.fn();
const markJobSucceeded = vi.fn();
const markJobFailed = vi.fn();
const releaseJob = vi.fn();
const handleBuildPack = vi.fn();
const handleBackfillShopOrders = vi.fn();

vi.mock("@/lib/jobs/claimJobs", () => ({ claimJobs, markJobSucceeded, markJobFailed, releaseJob }));
vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));
vi.mock("@/lib/jobs/handlers/buildPackJob", () => ({ handleBuildPack }));
vi.mock("@/lib/jobs/handlers/renderPdfJob", () => ({ handleRenderPdf: vi.fn() }));
vi.mock("@/lib/jobs/handlers/syncDisputesJob", () => ({ handleSyncDisputes: vi.fn() }));
vi.mock("@/lib/jobs/handlers/saveToShopifyJob", () => ({ handleSaveToShopify: vi.fn() }));
vi.mock("@/lib/jobs/handlers/buildDefencePackageJob", () => ({ handleBuildDefencePackage: vi.fn() }));
vi.mock("@/lib/jobs/handlers/snapshotShopDailyMetricsJob", () => ({ handleSnapshotShopDailyMetrics: vi.fn() }));
vi.mock("@/lib/jobs/handlers/backfillShopDailyMetricsJob", () => ({ handleBackfillShopDailyMetrics: vi.fn() }));
vi.mock("@/lib/jobs/handlers/backfillOrdersJob", () => ({ handleBackfillShopOrders }));
vi.mock("@/lib/jobs/handlers/snapshotFraudDailyMetricsJob", () => ({ handleSnapshotFraudDailyMetrics: vi.fn() }));
vi.mock("@/lib/jobs/handlers/backfillFraudDailyMetricsJob", () => ({ handleBackfillFraudDailyMetrics: vi.fn() }));
vi.mock("@/lib/jobs/handlers/reconcileMissingOrderJob", () => ({ handleReconcileMissingOrder: vi.fn() }));
vi.mock("@/lib/jobs/handlers/enrichGorgiasCommsJob", () => ({ handleEnrichGorgiasComms: vi.fn() }));
vi.mock("@/lib/jobs/handlers/intelligenceRunJob", () => ({ handleIntelligenceRun: vi.fn() }));
vi.mock("@/lib/jobs/handlers/replayBlockedBuildsJob", () => ({ handleReplayBlockedBuilds: vi.fn() }));
vi.mock("@/lib/jobs/handlers/collectProductEvidenceJob", () => ({ handleCollectProductEvidence: vi.fn() }));

const job = (id: string, shopId = "shop-a") => ({
  id,
  shopId,
  jobType: "build_pack",
  entityId: `pack-${id}`,
  attempts: 1,
  maxAttempts: 3,
});

async function run() {
  const { GET } = await import("@/app/api/jobs/worker/route");
  const res = await GET(new NextRequest("http://localhost/api/jobs/worker"));
  return (await res.json()) as { claimed: number; results: Array<{ jobId: string; status: string }> };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T10:24:38Z"));
  for (const m of [claimJobs, markJobSucceeded, markJobFailed, releaseJob, handleBuildPack, handleBackfillShopOrders]) m.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("worker — re-claims within the start budget", () => {
  it("drains a one-shop backlog in one invocation instead of one job per tick", async () => {
    claimJobs
      .mockResolvedValueOnce([job("1")])
      .mockResolvedValueOnce([job("2")])
      .mockResolvedValueOnce([job("3")])
      .mockResolvedValue([]);

    const body = await run();

    expect(handleBuildPack).toHaveBeenCalledTimes(3);
    expect(body.claimed).toBe(3);
    expect(body.results.map((r) => r.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(claimJobs).toHaveBeenCalledTimes(4);
  });

  it("stops claiming once the start budget is spent", async () => {
    claimJobs.mockImplementation(async () => [job(String(claimJobs.mock.calls.length))]);
    // Each job takes 60 s: jobs start at 0, 60, 120 s; at 180 s the budget (150 s) is gone.
    handleBuildPack.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 60_000);
    });

    const body = await run();

    expect(handleBuildPack).toHaveBeenCalledTimes(3);
    expect(claimJobs).toHaveBeenCalledTimes(3);
    expect(body.claimed).toBe(3);
  });

  it("releases the rest of a batch when the budget runs out mid-batch, and claims no more", async () => {
    claimJobs.mockResolvedValue([job("1", "shop-a"), job("2", "shop-b")]);
    handleBuildPack.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 200_000);
    });

    const body = await run();

    expect(handleBuildPack).toHaveBeenCalledTimes(1);
    expect(releaseJob).toHaveBeenCalledWith("2", expect.any(String), 1);
    expect(claimJobs).toHaveBeenCalledTimes(1);
    expect(body.results.map((r) => r.status)).toEqual(["succeeded", "released"]);
  });

  it("does not run the same job twice in one invocation — a retry waits for the next tick", async () => {
    handleBuildPack.mockRejectedValueOnce(new Error("shopify 503"));
    claimJobs
      .mockResolvedValueOnce([job("1")])
      .mockResolvedValueOnce([{ ...job("1"), attempts: 2 }])
      .mockResolvedValue([]);

    const body = await run();

    expect(handleBuildPack).toHaveBeenCalledTimes(1);
    expect(markJobFailed).toHaveBeenCalledTimes(1);
    expect(releaseJob).toHaveBeenCalledWith("1", expect.any(String), 2);
    expect(body.claimed).toBe(1);
  });

  it("still runs fresh work for another shop alongside a job it has already handled", async () => {
    handleBuildPack.mockRejectedValueOnce(new Error("shopify 503"));
    claimJobs
      .mockResolvedValueOnce([job("1", "shop-a")])
      .mockResolvedValueOnce([{ ...job("1", "shop-a"), attempts: 2 }, job("9", "shop-b")])
      .mockResolvedValue([]);

    const body = await run();

    expect(handleBuildPack).toHaveBeenCalledTimes(2);
    expect(body.results.map((r) => `${r.jobId}:${r.status}`)).toEqual([
      "1:failed",
      "1:released",
      "9:succeeded",
    ]);
  });

  it("does not start a long job type part-way through the invocation", async () => {
    // A 240 s order backfill claimed in round 2 would be killed at 300 s.
    claimJobs
      .mockResolvedValueOnce([job("1", "shop-a")])
      .mockResolvedValueOnce([
        job("2", "shop-a"),
        { ...job("7", "shop-b"), jobType: "backfill_shop_orders" },
      ])
      .mockResolvedValueOnce([{ ...job("7", "shop-b"), jobType: "backfill_shop_orders" }])
      .mockResolvedValue([]);

    const body = await run();

    expect(handleBackfillShopOrders).not.toHaveBeenCalled();
    expect(handleBuildPack).toHaveBeenCalledTimes(2);
    expect(body.results.map((r) => `${r.jobId}:${r.status}`)).toEqual([
      "1:succeeded",
      "7:released",
      "2:succeeded",
      "7:released",
    ]);
  });

  it("still starts a long job type from the first claim, as before", async () => {
    claimJobs
      .mockResolvedValueOnce([{ ...job("7", "shop-b"), jobType: "backfill_shop_orders" }])
      .mockResolvedValue([]);

    const body = await run();

    expect(handleBackfillShopOrders).toHaveBeenCalledTimes(1);
    expect(body.results).toEqual([{ jobId: "7", status: "succeeded" }]);
  });

  it("an RPC failure after progress ends the invocation cleanly", async () => {
    // `claimJobs` returns [] when the RPC errors.
    claimJobs.mockResolvedValueOnce([job("1")]).mockResolvedValue([]);
    const body = await run();
    expect(body).toEqual({ claimed: 1, results: [{ jobId: "1", status: "succeeded" }] });
  });

  it("an empty queue is one claim and no work", async () => {
    claimJobs.mockResolvedValue([]);
    const body = await run();
    expect(claimJobs).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ claimed: 0, results: [] });
  });
});

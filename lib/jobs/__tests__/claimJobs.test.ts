/**
 * Tests for `claimJobs` RPC wiring.
 *
 * The reclaim behavior itself lives in the plpgsql function and is
 * covered by scripts/sql/test-claim-jobs-reclaim.sql (run against a live
 * Postgres). Here we only assert the TS seam: that the stale-lock timeout
 * is actually forwarded to the RPC so the reclaim step runs. A regression
 * that dropped this param would silently revert to the pre-reclaim
 * (wedge-forever) behavior — hence the explicit test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { claimJobs } from "../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);

describe("claimJobs — RPC wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the stale-lock timeout so claim_jobs runs its reclaim step", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    mockGetServiceClient.mockReturnValue(
      { rpc } as unknown as ReturnType<typeof getServiceClient>,
    );

    await claimJobs("worker-abc", 5);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0];
    expect(fn).toBe("claim_jobs");
    expect(params).toEqual({
      p_worker_id: "worker-abc",
      p_limit: 5,
      p_max_concurrent: 1,
      // 600s = 2× the worker's 300s maxDuration; without this the RPC
      // would resolve without a reclaim window.
      p_lock_timeout_seconds: 600,
    });
  });

  it("maps claimed rows into ClaimedJob shape", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "job-1",
          shop_id: "shop-1",
          job_type: "backfill_shop_orders",
          entity_id: "cursor-xyz",
          attempts: 2,
          max_attempts: 3,
          priority: 20,
        },
      ],
      error: null,
    });
    mockGetServiceClient.mockReturnValue(
      { rpc } as unknown as ReturnType<typeof getServiceClient>,
    );

    const jobs = await claimJobs("worker-abc");

    expect(jobs).toEqual([
      {
        id: "job-1",
        shopId: "shop-1",
        jobType: "backfill_shop_orders",
        entityId: "cursor-xyz",
        attempts: 2,
        maxAttempts: 3,
        priority: 20,
      },
    ]);
  });

  it("returns [] when the RPC errors (never throws into the worker loop)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    mockGetServiceClient.mockReturnValue(
      { rpc } as unknown as ReturnType<typeof getServiceClient>,
    );

    const jobs = await claimJobs("worker-abc");
    expect(jobs).toEqual([]);
  });
});

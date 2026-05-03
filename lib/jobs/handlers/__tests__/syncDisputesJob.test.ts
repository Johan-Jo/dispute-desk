/**
 * Tests for `handleSyncDisputes` (Phase 4.2).
 *
 * The handler is a thin shim: it forwards a ClaimedJob's shopId + id
 * to the shared `syncDisputes` service. The tests verify the
 * forwarding contract — particularly that `triggerAutomation: true`
 * stays on (deferred-alert flow depends on this) and that the job
 * id is propagated as the correlationId so logs across the worker
 * + the inner service can be cross-referenced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/disputes/syncDisputes", () => ({
  syncDisputes: vi.fn(),
}));

import { syncDisputes } from "@/lib/disputes/syncDisputes";
import { handleSyncDisputes } from "../syncDisputesJob";
import type { ClaimedJob } from "../../claimJobs";

const mockSyncDisputes = vi.mocked(syncDisputes);

function makeJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: "job-abc",
    shopId: "shop-123",
    jobType: "sync_disputes",
    entityId: null,
    attempts: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("handleSyncDisputes", () => {
  beforeEach(() => {
    mockSyncDisputes.mockReset();
  });

  it("forwards shopId, triggerAutomation:true, and a job-prefixed correlationId", async () => {
    mockSyncDisputes.mockResolvedValue({
      synced: 5,
      created: 2,
      updated: 3,
      errors: [],
    });
    const job = makeJob({ id: "job-xyz", shopId: "shop-42" });

    await handleSyncDisputes(job);

    expect(mockSyncDisputes).toHaveBeenCalledTimes(1);
    expect(mockSyncDisputes).toHaveBeenCalledWith("shop-42", {
      triggerAutomation: true,
      correlationId: "job-job-xyz",
    });
  });

  it("propagates errors so the worker can mark the job failed", async () => {
    const upstream = new Error("Shopify dispute list fetch failed");
    mockSyncDisputes.mockRejectedValue(upstream);

    await expect(handleSyncDisputes(makeJob())).rejects.toThrow(
      "Shopify dispute list fetch failed",
    );
  });
});

/**
 * Tests for `markJobFailed` retriable flag (Phase 2.6).
 *
 * The flag controls whether a failed job goes back to the queue
 * (status="queued" with a delayed run_at) or is parked permanently
 * (status="failed"). Two axes:
 *   1. attempts vs maxAttempts (existing behavior).
 *   2. retriable: false override (new in Phase 2.6) — forces
 *      "failed" regardless of attempts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { markJobFailed } from "../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeSb() {
  const updateCalls: Array<Record<string, unknown>> = [];
  const update = vi.fn((patch: Record<string, unknown>) => {
    updateCalls.push(patch);
    return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
  });
  const sb = { from: vi.fn(() => ({ update })) };
  return { sb, updateCalls };
}

describe("markJobFailed — retriable flag (Phase 2.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries when attempts < maxAttempts and retriable is unspecified (legacy default)", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await markJobFailed("job-1", "transient timeout", 1, 3);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        status: "queued",
        last_error: "transient timeout",
      }),
    );
    // run_at gets a delayed retry timestamp.
    expect(updateCalls[0].run_at).toEqual(expect.any(String));
  });

  it("parks the job (status=failed) when attempts >= maxAttempts", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await markJobFailed("job-2", "exhausted", 3, 3);

    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        last_error: "exhausted",
      }),
    );
    // No retry → no run_at timestamp written.
    expect(updateCalls[0].run_at).toBeUndefined();
  });

  it("forces status=failed when retriable: false even on the first attempt", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    // attempts < maxAttempts but the handler decided this is non-retriable
    // (auth invalid, pack status not submittable, Shopify userErrors).
    await markJobFailed("job-3", "shopify_auth_invalid", 0, 3, {
      retriable: false,
    });

    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        last_error: "shopify_auth_invalid",
      }),
    );
    expect(updateCalls[0].run_at).toBeUndefined();
  });

  it("retriable: true is equivalent to the legacy default", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await markJobFailed("job-4", "transient", 1, 3, { retriable: true });

    expect(updateCalls[0].status).toBe("queued");
    expect(updateCalls[0].run_at).toEqual(expect.any(String));
  });
});

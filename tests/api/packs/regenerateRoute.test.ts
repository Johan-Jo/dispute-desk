/**
 * Route-level tests for POST /api/packs/:packId/regenerate.
 *
 * Resubmission Window endpoint. Behaviors covered:
 *   - 404 when pack not found
 *   - 409 INVALID_REGENERATE_WINDOW when no dispute is linked
 *   - 409 WINDOW_CLOSED when dispute.submission_state = "submitted_confirmed"
 *   - 409 INVALID_REGENERATE_WINDOW when state is "not_saved"
 *   - Idle path: sets rebuild_pending=true, enqueues exactly one
 *     build_pack, does NOT change evidence_packs.status
 *   - In-flight path (pack.status="building"): sets rebuild_pending=true,
 *     returns 202 with coalesced=true, does NOT enqueue
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/middleware/extractShopId", () => ({
  extractShopId: () => "shop-1",
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { POST } from "@/app/api/packs/[packId]/regenerate/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);

const packId = "pack-uuid-1";
const shopId = "shop-1";
const disputeId = "dispute-1";

interface ScenarioRows {
  pack: Record<string, unknown> | null;
  dispute?: Record<string, unknown> | null;
}

interface ScenarioSpies {
  jobsInsert: ReturnType<typeof vi.fn>;
  packsUpdate: ReturnType<typeof vi.fn>;
  packsUpdateEq: ReturnType<typeof vi.fn>;
}

function mockSupabase(rows: ScenarioRows): ScenarioSpies {
  const jobsInsert = vi
    .fn()
    .mockResolvedValue({ data: null, error: null });
  const packsUpdateEq = vi
    .fn()
    .mockResolvedValue({ data: null, error: null });
  const packsUpdate = vi.fn().mockReturnValue({ eq: packsUpdateEq });

  const mockFrom = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: rows.pack,
          error: rows.pack ? null : { message: "not found" },
        }),
        update: packsUpdate,
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: rows.dispute ?? null,
          error: null,
        }),
      };
    }
    if (table === "jobs") {
      return { insert: jobsInsert };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  return { jobsInsert, packsUpdate, packsUpdateEq };
}

function makeReq() {
  return new NextRequest("https://example.com/api/packs/x/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockLogAuditEvent.mockClear();
  mockGetServiceClient.mockReset();
});

describe("POST /api/packs/:packId/regenerate", () => {
  it("returns 404 when pack not found", async () => {
    mockSupabase({ pack: null });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ packId }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 INVALID_REGENERATE_WINDOW when pack has no dispute (library pack)", async () => {
    mockSupabase({
      pack: {
        id: packId,
        shop_id: shopId,
        dispute_id: null,
        status: "ready",
      },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ packId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REGENERATE_WINDOW");
  });

  it("returns 409 WINDOW_CLOSED when submission_state = submitted_confirmed", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId,
        shop_id: shopId,
        dispute_id: disputeId,
        status: "saved_to_shopify_verified",
      },
      dispute: {
        submission_state: "submitted_confirmed",
        submitted_at: "2026-05-17T12:00:00Z",
      },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ packId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("WINDOW_CLOSED");
    expect(body.submittedAt).toBe("2026-05-17T12:00:00Z");
    expect(spies.jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 409 INVALID_REGENERATE_WINDOW when submission_state = not_saved", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId,
        shop_id: shopId,
        dispute_id: disputeId,
        status: "ready",
      },
      dispute: {
        submission_state: "not_saved",
        submitted_at: null,
      },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ packId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REGENERATE_WINDOW");
    expect(body.currentState).toBe("not_saved");
    expect(spies.jobsInsert).not.toHaveBeenCalled();
  });

  it("idle path: sets rebuild_pending=true and enqueues exactly one build_pack without changing status", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId,
        shop_id: shopId,
        dispute_id: disputeId,
        status: "saved_to_shopify_verified",
      },
      dispute: {
        submission_state: "saved_to_shopify",
        submitted_at: null,
      },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ packId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("regenerating");
    expect(body.coalesced).toBe(false);

    expect(spies.jobsInsert).toHaveBeenCalledTimes(1);
    expect(spies.jobsInsert).toHaveBeenCalledWith({
      shop_id: shopId,
      job_type: "build_pack",
      entity_id: packId,
      priority: 20,
    });

    // The update should set rebuild_pending=true but must NOT include
    // a `status` key — the previous Shopify save stays canonical until
    // the new one verifies.
    expect(spies.packsUpdate).toHaveBeenCalled();
    const updateArgs = spies.packsUpdate.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updateArgs?.rebuild_pending).toBe(true);
    expect(updateArgs).not.toHaveProperty("status");
  });

  it("in-flight path (status=building): sets rebuild_pending=true and does NOT enqueue duplicate job", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId,
        shop_id: shopId,
        dispute_id: disputeId,
        status: "building",
      },
      dispute: {
        submission_state: "saved_to_shopify",
        submitted_at: null,
      },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ packId }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.coalesced).toBe(true);

    expect(spies.jobsInsert).not.toHaveBeenCalled();

    const updateArgs = spies.packsUpdate.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updateArgs?.rebuild_pending).toBe(true);
    expect(updateArgs).not.toHaveProperty("status");
  });
});

/**
 * PR-C1 — the portal approval endpoint performs NO side effect for an unsafe
 * candidate.
 *
 * Ordering is the test: the preflight must run before `approved_for_save_at`
 * is stamped and before the job is inserted, so a refused approval leaves no
 * approval trace, no queued job and no audit row claiming approval.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/packs/[packId]/approve/route";
import { NextRequest } from "next/server";

const mockClient = vi.mocked(getServiceClient);

const PACK_ID = "pack-1";
const DISPUTE_ID = "dispute-1";

const CLEAN = {
  facts_json: [{ id: "f1", category: "delivery_proof", value: { proofType: "delivered_confirmed" } }],
  narrative_json: {
    fulfillmentArgument: { text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1)." },
  },
};
const UNSAFE = {
  facts_json: CLEAN.facts_json,
  narrative_json: {
    fulfillmentArgument: { text: "The parcel was delivered to the cardholder's verified address." },
  },
};

function mockSupabase(latest: Record<string, unknown> | null) {
  const packUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const jobsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
    }),
  });
  const auditInsert = vi.fn().mockResolvedValue({ data: null, error: null });

  const from = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: PACK_ID,
            shop_id: "shop-1",
            dispute_id: DISPUTE_ID,
            status: "ready",
            completeness_score: 90,
          },
          error: null,
        }),
        update: packUpdate,
      };
    }
    if (table === "defence_packages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: latest, error: null }),
      };
    }
    if (table === "jobs") return { insert: jobsInsert };
    if (table === "audit_events") return { insert: auditInsert };
    throw new Error(`unexpected table: ${table}`);
  });
  mockClient.mockReturnValue({ from } as never);
  return { packUpdate, jobsInsert, auditInsert };
}

const req = () =>
  new NextRequest("https://x.test/api/packs/pack-1/approve", {
    method: "POST",
    body: JSON.stringify({ user_id: "user-1" }),
    headers: { "content-type": "application/json" },
  });
const params = { params: Promise.resolve({ packId: PACK_ID }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/packs/:packId/approve — PR-C1 preflight", () => {
  it("refuses an unsafe candidate with NO approval, NO status write, NO enqueue", async () => {
    const { packUpdate, jobsInsert, auditInsert } = mockSupabase({
      id: "pkg-3",
      version: 3,
      ...UNSAFE,
    });

    const res = await POST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("PACKAGE_REVIEW_REQUIRED");
    expect(body.reasons).toContain("affirmative_address_delivery_claim");

    // No approval stamp, no job, no "manual_approved_for_save" audit row.
    expect(packUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("refuses an unreadable candidate — fails closed", async () => {
    const { packUpdate, jobsInsert } = mockSupabase({
      id: "pkg-3",
      version: 3,
      facts_json: null,
      narrative_json: null,
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect(packUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("approves and enqueues normally for a safe candidate", async () => {
    const { packUpdate, jobsInsert } = mockSupabase({ id: "pkg-4", version: 4, ...CLEAN });
    const res = await POST(req(), params);
    expect(res.status).toBe(202);
    expect(packUpdate).toHaveBeenCalledTimes(1);
    expect(jobsInsert).toHaveBeenCalledTimes(1);
  });

  it("approves normally when no defence package exists yet", async () => {
    const { jobsInsert } = mockSupabase(null);
    const res = await POST(req(), params);
    expect(res.status).toBe(202);
    expect(jobsInsert).toHaveBeenCalledTimes(1);
  });
});

/**
 * POST /api/packs/:packId/bank-claim — records the bank's claim for the
 * dispute's current response cycle, clears the task and queues a rebuild.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/resolveActor", () => ({
  resolveAuditActor: vi.fn().mockResolvedValue({ actorType: "merchant", actorId: "u1" }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { POST } from "@/app/api/packs/[packId]/bank-claim/route";
import { NextRequest } from "next/server";

const mockClient = vi.mocked(getServiceClient);

function setup(opts: { packStatus?: string; submissionState?: string; cycle?: number } = {}) {
  const upserts: Record<string, unknown>[] = [];
  const disputeUpdates: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const from = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.single = vi.fn(async () => ({
        data: { id: "pack-1", shop_id: "shop-1", dispute_id: "d-1", status: opts.packStatus ?? "ready" },
        error: null,
      }));
      return q;
    }
    if (table === "disputes") {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.single = vi.fn(async () => ({
        data: { submission_state: opts.submissionState ?? "not_saved", response_cycle: opts.cycle ?? 2 },
        error: null,
      }));
      q.update = vi.fn((row: Record<string, unknown>) => {
        disputeUpdates.push(row);
        const u: Record<string, unknown> = {};
        u.eq = vi.fn(() => u);
        u.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
        return u;
      });
      return q;
    }
    if (table === "dispute_bank_claims") {
      return {
        upsert: vi.fn((row: Record<string, unknown>) => {
          upserts.push(row);
          return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "bc-1" }, error: null })) })) };
        }),
      };
    }
    if (table === "jobs") {
      return { insert: vi.fn(async (row: Record<string, unknown>) => { jobs.push(row); return { error: null }; }) };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  mockClient.mockReturnValue({ from } as never);
  return { upserts, disputeUpdates, jobs };
}

const req = (body: unknown) =>
  new NextRequest("https://x.test/api/packs/pack-1/bank-claim", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const params = { params: Promise.resolve({ packId: "pack-1" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/packs/:packId/bank-claim", () => {
  it("400 when neither a claim nor 'no claim shown' is given", async () => {
    setup();
    const res = await POST(req({ text: "   " }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("CLAIM_REQUIRED");
  });

  it("409 while the pack is building, and after Shopify forwarded the evidence", async () => {
    setup({ packStatus: "building" });
    expect((await POST(req({ text: "x" }), params)).status).toBe(409);
    setup({ submissionState: "submitted_confirmed" });
    const res = await POST(req({ text: "x" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("WINDOW_CLOSED");
  });

  it("stores the claim for the current cycle, clears the task, audits without the text, and queues a rebuild", async () => {
    const { upserts, disputeUpdates, jobs } = setup({ cycle: 2 });
    const res = await POST(req({ text: "  Buyer says the item was not as described  " }), params);
    expect(res.status).toBe(201);
    expect(upserts[0]).toMatchObject({
      dispute_id: "d-1",
      response_cycle: 2,
      claim_text: "Buyer says the item was not as described",
      no_claim_shown: false,
    });
    expect(disputeUpdates[0]).toMatchObject({ attention_reason: null, needs_attention: false });
    expect(jobs[0]).toMatchObject({ job_type: "build_pack", entity_id: "pack-1" });
    const audit = vi.mocked(logAuditEvent).mock.calls[0]![0];
    expect(audit.eventType).toBe("bank_claim_recorded");
    expect(JSON.stringify(audit.eventPayload)).not.toContain("not as described");
  });

  it("accepts 'Shopify shows no claim'", async () => {
    const { upserts } = setup();
    const res = await POST(req({ noClaimShown: true }), params);
    expect(res.status).toBe(201);
    expect(upserts[0]).toMatchObject({ claim_text: null, no_claim_shown: true });
  });
});

/**
 * POST /api/packs/:packId/bank-claim — records the bank's claim for the
 * dispute's current response cycle, clears the task and queues a rebuild.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/disputes/bankClaimFile", async (orig) => {
  const actual = await orig<typeof import("@/lib/disputes/bankClaimFile")>();
  return {
    ...actual,
    extractBankClaimText: vi.fn(async () => ({ text: "Issuer claim: item not as described", source: "file_ai" })),
  };
});
vi.mock("@/lib/disputes/bankClaimAnalysisStore", () => ({
  ensureBankClaimAnalysis: vi.fn(async () => ({ reason: "PRODUCT_UNACCEPTABLE", authorizationDisputed: false, returnOrRefundRequested: true })),
}));
vi.mock("@/lib/audit/resolveActor", () => ({
  resolveAuditActor: vi.fn().mockResolvedValue({ actorType: "merchant", actorId: "u1" }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { DELETE, POST } from "@/app/api/packs/[packId]/bank-claim/route";
import { NextRequest } from "next/server";

const mockClient = vi.mocked(getServiceClient);

function setup(opts: { packStatus?: string; submissionState?: string; cycle?: number } = {}) {
  const upserts: Record<string, unknown>[] = [];
  const disputeUpdates: Record<string, unknown>[] = [];
  const jobs: Record<string, unknown>[] = [];
  const stored: Array<{ path: string; opts: unknown }> = [];
  const deletes: boolean[] = [];
  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn(async (path: string, _b: unknown, opts: unknown) => {
        stored.push({ path, opts });
        return { error: null };
      }),
    })),
  };
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
        delete: vi.fn(() => {
          const d: Record<string, unknown> = {};
          d.eq = vi.fn(() => d);
          d.then = (r: (v: unknown) => unknown) => {
            deletes.push(true);
            return Promise.resolve({ error: null }).then(r);
          };
          return d;
        }),
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
  mockClient.mockReturnValue({ from, storage } as never);
  return { upserts, disputeUpdates, jobs, stored, deletes };
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
    // attention_payload is NOT NULL in the DB: clearing must write {} (null was rejected on prod).
    expect(disputeUpdates[0]).toMatchObject({ attention_reason: null, needs_attention: false, attention_payload: {} });
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

function fileReq(name: string, bytes: number) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
  return new NextRequest("https://x.test/api/packs/pack-1/bank-claim", { method: "POST", body: form });
}

describe("POST /api/packs/:packId/bank-claim — file upload", () => {
  it("stores the file, saves the text read from it, and queues a rebuild", async () => {
    const { upserts, stored, jobs } = setup({ cycle: 2 });
    const res = await POST(fileReq("issuer-claim.pdf", 2048), params);
    expect(res.status).toBe(201);
    expect(stored[0]!.path).toMatch(/^shop-1\/d-1\/bank-claim-c2-\d+\.pdf$/);
    expect(upserts[0]).toMatchObject({
      response_cycle: 2,
      claim_text: "Issuer claim: item not as described",
      text_source: "file_ai",
      file_name: "issuer-claim.pdf",
      file_size: 2048,
    });
    expect(jobs[0]).toMatchObject({ job_type: "build_pack" });
    // A re-answer is analysed afresh; the analysis lands in the audit row.
    expect(upserts[0]).toMatchObject({ analysis: null });
    const audit = vi.mocked(logAuditEvent).mock.calls.at(-1)![0];
    expect(audit.eventPayload).toMatchObject({ analysis: { reason: "PRODUCT_UNACCEPTABLE", returnOrRefundRequested: true } });
  });

  it("rejects an unsupported type and a file over 10 MB before storing anything", async () => {
    const a = setup();
    expect((await POST(fileReq("virus.exe", 10), params)).status).toBe(400);
    expect(a.stored).toHaveLength(0);
    const b = setup();
    const res = await POST(fileReq("big.pdf", 10 * 1024 * 1024 + 1), params);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("FILE_TOO_LARGE");
    expect(b.stored).toHaveLength(0);
  });
});

describe("DELETE /api/packs/:packId/bank-claim — withdraw ('Cancel')", () => {
  it("removes the saved claim for the current cycle, audits it and queues a rebuild", async () => {
    const { deletes, jobs } = setup({ cycle: 2 });
    const res = await DELETE(new NextRequest("https://x.test/api/packs/pack-1/bank-claim", { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(deletes).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ job_type: "build_pack" });
    expect(vi.mocked(logAuditEvent).mock.calls.at(-1)![0].eventType).toBe("bank_claim_withdrawn");
  });

  it("refuses once Shopify forwarded the evidence", async () => {
    const { deletes } = setup({ submissionState: "submitted_confirmed" });
    const res = await DELETE(new NextRequest("https://x.test/api/packs/pack-1/bank-claim", { method: "DELETE" }), params);
    expect(res.status).toBe(409);
    expect(deletes).toHaveLength(0);
  });
});

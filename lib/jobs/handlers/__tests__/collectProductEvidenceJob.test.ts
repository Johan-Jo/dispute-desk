/**
 * Not-as-described plan PR 3 — the one retry, and enqueueJob's opt-in
 * duplicate mode (acceptance #2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const inserts: Array<Record<string, unknown>> = [];
let insertError: { code?: string; message: string } | null = null;
const tables: Record<string, unknown[]> = {};

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => q;
      q.limit = async () => ({ data: tables[table] ?? [], error: null });
      q.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
      q.insert = (row: Record<string, unknown>) => {
        inserts.push({ table, ...row });
        return { select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "job-new" }, error: null }) }) };
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/shopify/sessions/getShopBackgroundSession", () => ({
  getShopBackgroundSession: async () => ({ shopDomain: "s.myshopify.com", accessToken: "t" }),
}));
vi.mock("@/lib/packs/productListing/collectProductListings", () => ({ collectProductListings: vi.fn() }));

import { enqueueJob } from "../../claimJobs";
import { handleCollectProductEvidence } from "../collectProductEvidenceJob";
import { collectProductListings } from "@/lib/packs/productListing/collectProductListings";

const mockCollect = vi.mocked(collectProductListings);
const JOB = { id: "j1", shopId: "shop-1", jobType: "collect_product_evidence", entityId: "pack-1", attempts: 0, maxAttempts: 3 };

describe("enqueueJob onDuplicate", () => {
  beforeEach(() => {
    inserts.length = 0;
    insertError = null;
  });

  it("returns { duplicate: true } on 23505 when asked", async () => {
    insertError = { code: "23505", message: "duplicate key" };
    await expect(enqueueJob({ shopId: "s", jobType: "x", dedupeKey: "k" }, { onDuplicate: "return" })).resolves.toEqual({ id: null, duplicate: true });
  });

  it("still throws on 23505 without the option (every existing caller)", async () => {
    insertError = { code: "23505", message: "duplicate key" };
    await expect(enqueueJob({ shopId: "s", jobType: "x", dedupeKey: "k" })).rejects.toThrow(/duplicate key/);
  });
});

describe("handleCollectProductEvidence", () => {
  const prev = process.env.PRODUCT_LISTING_EVIDENCE_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.length = 0;
    insertError = null;
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "true";
    tables.evidence_packs = [{ id: "pack-1", shop_id: "shop-1", dispute_id: "disp-1" }];
    tables.disputes = [{ id: "disp-1", order_gid: "gid://shopify/Order/1", closed_at: null }];
    tables.defence_packages = [];
    tables.jobs = [];
  });
  afterEach(() => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = prev;
  });

  it("success: enqueues one normal pack rebuild and no further retry", async () => {
    mockCollect.mockResolvedValue({ outcomes: [{ lineItemGid: "li", outcome: "present" }], listings: [], anyFailed: false });
    expect(await handleCollectProductEvidence(JOB)).toEqual({ ok: true });
    const jobs = inserts.filter((r) => r.table === "jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ job_type: "build_pack", entity_id: "pack-1" });
  });

  it("success but a letter is already filed: no rebuild", async () => {
    tables.defence_packages = [{ id: "dp" }];
    mockCollect.mockResolvedValue({ outcomes: [], listings: [], anyFailed: false });
    await handleCollectProductEvidence(JOB);
    expect(inserts.filter((r) => r.table === "jobs")).toHaveLength(0);
  });

  it("second failure is final: non-retriable, nothing enqueued", async () => {
    mockCollect.mockResolvedValue({ outcomes: [{ lineItemGid: null, outcome: "failed" }], listings: [], anyFailed: true });
    expect(await handleCollectProductEvidence(JOB)).toMatchObject({ ok: false, retriable: false });
    expect(inserts).toHaveLength(0);
  });
});

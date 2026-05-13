import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Cross-shop ownership filter test. Verifies every per-shop route family
// requires `x-shop-id` and refuses to return another shop's data.
//
// One canonical assertion per resource family — the fix is mechanical
// (`.eq("id", id).eq("shop_id", shopId)`) so the matrix doesn't need
// exhaustive route coverage to prove the contract.

const sbState: {
  shopForId: Record<string, string>; // entityId -> owning shopId
  rows: Record<string, Record<string, unknown>>;
} = { shopForId: {}, rows: {} };

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => makeMockClient(),
}));

// Shared mocks so the routes' imports resolve cleanly. The actual
// downstream side-effects (audit logs, automation pipeline, etc.) are
// stubbed — this test only asserts the shop-scoping guard.
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({ emitDisputeEvent: vi.fn() }));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn(),
}));
vi.mock("@/lib/automation/pipeline", () => ({
  runAutomationPipeline: vi.fn().mockResolvedValue({ action: "noop" }),
  evaluateAndMaybeAutoSave: vi.fn(),
}));

function makeMockClient() {
  const buildSelectChain = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      not: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      is: () => chain,
      single: async () => resolveQuery(table, filters),
      maybeSingle: async () => resolveQuery(table, filters),
    };
    return chain;
  };

  return {
    from: (table: string) => {
      const select = buildSelectChain(table);
      return {
        ...select,
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: "ent-new" }, error: null }),
          }),
        }),
        update: () => buildSelectChain(table),
        delete: () => buildSelectChain(table),
      };
    },
  };
}

function resolveQuery(
  table: string,
  filters: Array<[string, unknown]>,
): { data: unknown; error: unknown } {
  const idFilter = filters.find(([c]) => c === "id")?.[1] as string | undefined;
  const shopFilter = filters.find(([c]) => c === "shop_id")?.[1] as
    | string
    | undefined;
  if (!idFilter) return { data: null, error: null };
  const row = sbState.rows[`${table}:${idFilter}`];
  if (!row) return { data: null, error: { code: "PGRST116" } };
  if (shopFilter && row.shop_id !== shopFilter) {
    return { data: null, error: { code: "PGRST116" } };
  }
  return { data: row, error: null };
}

function seed(table: string, row: { id: string; shop_id: string } & Record<string, unknown>) {
  sbState.rows[`${table}:${row.id}`] = row;
  sbState.shopForId[row.id] = row.shop_id;
}

function makeReq(path: string, shopId: string | null): NextRequest {
  const headers = new Headers();
  if (shopId) headers.set("x-shop-id", shopId);
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers,
    method: "GET",
  });
}

beforeEach(() => {
  sbState.rows = {};
  sbState.shopForId = {};
  vi.clearAllMocks();
});

describe("cross-shop ownership filter", () => {
  describe("GET /api/disputes/:id", () => {
    it("returns 401 SHOP_CONTEXT_REQUIRED when x-shop-id is missing", async () => {
      const { GET } = await import("@/app/api/disputes/[id]/route");
      const res = await GET(makeReq("/api/disputes/d1", null), {
        params: Promise.resolve({ id: "d1" }),
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("SHOP_CONTEXT_REQUIRED");
    });

    it("returns 401 when x-shop-id is 'demo'", async () => {
      const { GET } = await import("@/app/api/disputes/[id]/route");
      const res = await GET(makeReq("/api/disputes/d1", "demo"), {
        params: Promise.resolve({ id: "d1" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when dispute belongs to another shop", async () => {
      seed("disputes", { id: "d1", shop_id: "shop-A", reason: "FRAUDULENT" });
      const { GET } = await import("@/app/api/disputes/[id]/route");
      const res = await GET(makeReq("/api/disputes/d1", "shop-B"), {
        params: Promise.resolve({ id: "d1" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/rules/:id", () => {
    it("returns 401 without shop context", async () => {
      const { GET } = await import("@/app/api/rules/[id]/route");
      const res = await GET(makeReq("/api/rules/r1", null), {
        params: Promise.resolve({ id: "r1" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when rule belongs to another shop", async () => {
      seed("rules", { id: "r1", shop_id: "shop-A" });
      const { GET } = await import("@/app/api/rules/[id]/route");
      const res = await GET(makeReq("/api/rules/r1", "shop-B"), {
        params: Promise.resolve({ id: "r1" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("returns 401 without shop context", async () => {
      const { GET } = await import("@/app/api/jobs/[id]/route");
      const res = await GET(makeReq("/api/jobs/j1", null), {
        params: Promise.resolve({ id: "j1" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 when job belongs to another shop", async () => {
      seed("jobs", { id: "j1", shop_id: "shop-A", job_type: "build_pack" });
      const { GET } = await import("@/app/api/jobs/[id]/route");
      const res = await GET(makeReq("/api/jobs/j1", "shop-B"), {
        params: Promise.resolve({ id: "j1" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/packs/:packId/save-to-shopify", () => {
    it("returns 401 without shop context", async () => {
      const { POST } = await import(
        "@/app/api/packs/[packId]/save-to-shopify/route"
      );
      const req = new NextRequest(
        new URL("http://localhost/api/packs/p1/save-to-shopify"),
        { method: "POST", headers: new Headers() },
      );
      const res = await POST(req, { params: Promise.resolve({ packId: "p1" }) });
      expect(res.status).toBe(401);
    });

    it("returns 404 when pack belongs to another shop", async () => {
      seed("evidence_packs", {
        id: "p1",
        shop_id: "shop-A",
        dispute_id: "d1",
        status: "ready",
        completeness_score: 90,
        submission_readiness: "ready",
      });
      const { POST } = await import(
        "@/app/api/packs/[packId]/save-to-shopify/route"
      );
      const req = new NextRequest(
        new URL("http://localhost/api/packs/p1/save-to-shopify"),
        {
          method: "POST",
          headers: new Headers({ "x-shop-id": "shop-B" }),
          body: JSON.stringify({}),
        },
      );
      const res = await POST(req, { params: Promise.resolve({ packId: "p1" }) });
      expect(res.status).toBe(404);
    });
  });
});

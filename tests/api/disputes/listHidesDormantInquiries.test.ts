import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Pins that GET /api/disputes does not LIST dormant inquiries (dead,
// deadline-less Shopify inquiries — lib/disputes/dormantInquiry.ts). They
// were already excluded from the KPI aggregates, which left rows in the
// merchant's list that no count acknowledged (cay-collective #4577 / #5225 /
// #5263, 2026-10-03). Only non-terminal rows are hidden: a resolved one must
// stay visible in history.

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const base = {
  shop_id: "shop-1",
  reason: "PRODUCT_NOT_RECEIVED",
  status: "under_review",
  amount: 100,
  currency_code: "SEK",
  normalized_status: "new",
  submission_state: "not_saved",
  final_outcome: null,
  closed_at: null,
  needs_attention: false,
  attention_reason: null,
  attention_payload: {},
};

let shopRows: Array<Record<string, unknown>> = [];
const notCalls: Array<[string, string, string]> = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => makeChain(),
  }),
}));

function makeChain() {
  const chain: Record<string, unknown> = {};
  let isShopScan = false;
  const self = () => chain;
  for (const m of ["eq", "neq", "in", "is", "gte", "lte", "or", "range", "limit", "order"]) {
    chain[m] = self;
  }
  chain.select = (cols: string) => {
    // The shop-wide presentation scan is the only select that names these
    // columns explicitly.
    if (typeof cols === "string" && cols.startsWith("id, shop_id, reason")) {
      isShopScan = true;
    }
    return chain;
  };
  chain.not = (col: string, op: string, val: string) => {
    notCalls.push([col, op, val]);
    return chain;
  };
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: isShopScan ? shopRows : [],
      error: null,
      count: 0,
    }).then(resolve);
  return chain;
}

function listReq(): NextRequest {
  return new NextRequest(new URL("http://localhost/api/disputes"), {
    method: "GET",
    headers: new Headers({ "x-shop-id": "shop-1" }),
  });
}

beforeEach(() => {
  notCalls.length = 0;
  shopRows = [];
  vi.clearAllMocks();
});

describe("GET /api/disputes — dormant inquiries are not listed", () => {
  it("excludes exactly the open, deadline-less, stale inquiries from the list query", async () => {
    shopRows = [
      // Dormant: open inquiry, no deadline, opened over a year ago.
      { ...base, id: "dormant-1", phase: "inquiry", due_at: null, initiated_at: iso(400 * DAY) },
      // Same shape but resolved — history, must stay listed.
      {
        ...base,
        id: "resolved-old",
        phase: "inquiry",
        due_at: null,
        initiated_at: iso(400 * DAY),
        closed_at: iso(10 * DAY),
        final_outcome: "won",
      },
      // Recent inquiry still waiting on a deadline — real workload.
      { ...base, id: "recent-inquiry", phase: "inquiry", due_at: null, initiated_at: iso(5 * DAY) },
      // Old chargeback — never dormant.
      { ...base, id: "old-chargeback", phase: "chargeback", due_at: null, initiated_at: iso(400 * DAY) },
    ];
    const { GET } = await import("@/app/api/disputes/route");
    const res = await GET(listReq());
    expect(res.status).toBe(200);
    expect(notCalls).toContainEqual(["id", "in", "(dormant-1)"]);
  });

  it("adds no exclusion when the shop has no dormant inquiries", async () => {
    shopRows = [
      { ...base, id: "recent-inquiry", phase: "inquiry", due_at: null, initiated_at: iso(5 * DAY) },
    ];
    const { GET } = await import("@/app/api/disputes/route");
    const res = await GET(listReq());
    expect(res.status).toBe(200);
    expect(notCalls.some(([col, op]) => col === "id" && op === "in")).toBe(false);
  });
});

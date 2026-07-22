import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Pins the urgency-sort ordering contract of GET /api/disputes:
// when sorting by due_at ascending ("Most urgent"), OPEN disputes
// (closed_at IS NULL) must rank before resolved ones. Resolved disputes
// keep their historical due_at — without the closed_at pre-key, a 2018
// lost chargeback sorted above a dispute due this week (blume-box,
// 2026-07-22).

const orderCalls: Array<[string, { ascending?: boolean; nullsFirst?: boolean }]> = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => makeChain(),
  }),
}));

function makeChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of [
    "select",
    "eq",
    "in",
    "not",
    "is",
    "gte",
    "lte",
    "or",
    "range",
    "limit",
  ]) {
    chain[m] = self;
  }
  chain.order = (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
    orderCalls.push([col, opts]);
    return chain;
  };
  // The route awaits the built query: resolve to an empty page.
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
  return chain;
}

function listReq(qs: string): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/disputes?${qs}`), {
    method: "GET",
    headers: new Headers({ "x-shop-id": "shop-1" }),
  });
}

beforeEach(() => {
  orderCalls.length = 0;
  vi.clearAllMocks();
});

describe("GET /api/disputes — urgency sort ordering", () => {
  it("due_at asc prepends closed_at (open first), then due_at, then created_at", async () => {
    const { GET } = await import("@/app/api/disputes/route");
    const res = await GET(listReq("sort=due_at&sort_dir=asc"));
    expect(res.status).toBe(200);
    expect(orderCalls[0]).toEqual([
      "closed_at",
      { ascending: false, nullsFirst: true },
    ]);
    expect(orderCalls[1]).toEqual([
      "due_at",
      { ascending: true, nullsFirst: false },
    ]);
    expect(orderCalls[2]?.[0]).toBe("created_at");
  });

  it("default sort (no params) is due_at asc and gets the same open-first pre-key", async () => {
    const { GET } = await import("@/app/api/disputes/route");
    const res = await GET(listReq(""));
    expect(res.status).toBe(200);
    expect(orderCalls[0]?.[0]).toBe("closed_at");
    expect(orderCalls[1]?.[0]).toBe("due_at");
  });

  it("non-due_at sorts are NOT prefixed with the closed_at key", async () => {
    const { GET } = await import("@/app/api/disputes/route");
    const res = await GET(listReq("sort=amount&sort_dir=desc"));
    expect(res.status).toBe(200);
    expect(orderCalls[0]).toEqual([
      "amount",
      { ascending: false, nullsFirst: false },
    ]);
    expect(orderCalls.some(([c]) => c === "closed_at")).toBe(false);
  });

  it("due_at DESC (explicit) is not treated as urgency — no closed_at pre-key", async () => {
    const { GET } = await import("@/app/api/disputes/route");
    const res = await GET(listReq("sort=due_at&sort_dir=desc"));
    expect(res.status).toBe(200);
    expect(orderCalls[0]?.[0]).toBe("due_at");
    expect(orderCalls.some(([c]) => c === "closed_at")).toBe(false);
  });
});

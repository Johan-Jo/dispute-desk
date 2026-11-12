/**
 * /api/admin/search backs the top-bar multi-search: shops, disputes, templates
 * and jobs in one request, grouped, empty groups omitted, safe against input
 * that would break PostgREST's or() syntax.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Res = { data: unknown[] | null; error: { message: string } | null };
let results: Record<string, Res> = {};
let calls: Array<{ table: string; method: string; args: unknown[] }> = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "or", "eq", "ilike", "in"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return chain;
        };
      }
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(results[table] ?? { data: [], error: null }).then(res);
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/admin/search/route";

const req = (q: string) => ({ nextUrl: new URL(`https://x/api/admin/search?q=${encodeURIComponent(q)}`) }) as never;
const UUID = "3c67cfb1-cf39-4db7-a455-9f6700ba7129";

beforeEach(() => {
  results = {};
  calls = [];
});

describe("GET /api/admin/search", () => {
  it("does not query anything for fewer than two characters", async () => {
    const body = await (await GET(req("a"))).json();
    expect(body.groups).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("searches every entity at once and returns only non-empty groups", async () => {
    results.shops = {
      data: [{ id: "s1", shop_domain: "whj8db-1q.myshopify.com", primary_domain: "hemochtrend.se", shop_name: "H", plan: "growth", uninstalled_at: null }],
      error: null,
    };
    results.disputes = {
      data: [{ id: "d1", order_name: "#1084", reason: "FRAUDULENT", phase: "chargeback", normalized_status: "submitted_to_bank", shop_id: "s1" }],
      error: null,
    };
    const body = await (await GET(req("hemo"))).json();
    expect(body.groups.map((g: { key: string }) => g.key)).toEqual(["shops", "disputes"]);

    const shop = body.groups[0].items[0];
    // storefront domain on line 1, myshopify alias on line 2 (the admin merchant format)
    expect(shop).toMatchObject({ title: "hemochtrend.se", subtitle: "whj8db-1q.myshopify.com", href: "/admin/shops/s1", badge: "growth" });

    const dispute = body.groups[1].items[0];
    expect(dispute).toMatchObject({ title: "#1084 · FRAUDULENT", href: "/admin/disputes/d1", badge: "submitted to bank" });
  });

  it("labels a dispute that has no order name by its Shopify id, not a bare Order", async () => {
    results.disputes = {
      data: [{ id: "d9", order_name: null, dispute_gid: "gid://shopify/ShopifyPaymentsDispute/123456", reason: "FRAUDULENT", phase: "chargeback", normalized_status: "new", shop_id: null }],
      error: null,
    };
    const body = await (await GET(req("123456"))).json();
    expect(body.groups[0].items[0].title).toBe("Dispute 123456 · FRAUDULENT");
  });

  it("matches an order number typed with or without the # sign", async () => {
    await GET(req("#1084"));
    const or = calls.find((c) => c.table === "disputes" && c.method === "or");
    expect(String(or?.args[0])).toContain("order_name.ilike.%1084%");
  });

  it("looks a uuid up exactly instead of pattern-matching it", async () => {
    await GET(req(UUID));
    expect(calls.some((c) => c.table === "shops" && c.method === "eq")).toBe(true);
    expect(calls.some((c) => c.table === "disputes" && c.method === "eq")).toBe(true);
    expect(calls.some((c) => c.table === "jobs" && c.method === "eq")).toBe(true);
  });

  it("strips characters that would break the or() filter", async () => {
    await GET(req("a,b)(%x"));
    const or = calls.find((c) => c.table === "shops" && c.method === "or");
    expect(String(or?.args[0])).toBe("shop_domain.ilike.%abx%,primary_domain.ilike.%abx%,shop_name.ilike.%abx%");
  });

  it("surfaces a database failure instead of an empty result", async () => {
    results.jobs = { data: null, error: { message: "boom" } };
    const res = await GET(req("backfill"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});

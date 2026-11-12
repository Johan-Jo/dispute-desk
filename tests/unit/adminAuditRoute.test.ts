/**
 * /api/admin/audit — shop events + platform-wide admin events, with a shop
 * filter that accepts a domain, input validation (partial UUIDs used to 500 and
 * crash the page), and CSV that survives commas, quotes and spreadsheet formulas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { csvCell, toCsv } from "@/lib/admin/csv";

type Result = { data: unknown[] | null; error: { message: string } | null };
const results: Record<string, Result> = {};
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "eq", "in", "gte", "lte", "or"]) {
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

import { GET } from "@/app/api/admin/audit/route";

const req = (qs = "") => ({ nextUrl: new URL(`https://x/api/admin/audit${qs}`) }) as never;

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(results)) delete results[k];
});

describe("csv", () => {
  it("quotes cells, doubles quotes and neutralises formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell(null)).toBe('""');
    expect(toCsv(["h"], [["x,y"]])).toBe('"h"\r\n"x,y"');
  });
});

describe("GET /api/admin/audit", () => {
  it("rejects a malformed date with 400, not a database 500", async () => {
    expect((await GET(req("?from=not-a-date"))).status).toBe(400);
  });

  it("accepts a partial UUID without querying Postgres with it", async () => {
    // A non-UUID is treated as a domain search, never passed to .eq('shop_id', …)
    results.shops = { data: [], error: null };
    const res = await GET(req("?shop=4f9a1c"));
    expect(res.status).toBe(200);
    expect((await res.json()).events).toEqual([]);
    expect(calls.some((c) => c.table === "audit_events")).toBe(false);
  });

  it("resolves a domain to shop ids and filters audit_events by them", async () => {
    results.shops = { data: [{ id: "11111111-1111-1111-1111-111111111111", shop_domain: "x.myshopify.com", primary_domain: "store.example" }], error: null };
    results.audit_events = {
      data: [{ id: "a1", shop_id: "11111111-1111-1111-1111-111111111111", event_type: "admin_override", actor_type: "admin", actor_id: "ops@example.com", created_at: "2026-11-12T10:00:00Z", event_payload: {} }],
      error: null,
    };
    const res = await GET(req("?shop=store.example"));
    const body = await res.json();
    expect(calls.some((c) => c.table === "audit_events" && c.method === "in")).toBe(true);
    expect(body.events[0].shop).toEqual({ shop_domain: "x.myshopify.com", primary_domain: "store.example" });
    expect(body.events[0].actor_id).toBe("ops@example.com");
  });

  it("merges platform-wide admin events, newest first, when unfiltered", async () => {
    results.audit_events = {
      data: [{ id: "a1", shop_id: null, event_type: "x", actor_type: "system", actor_id: null, created_at: "2026-11-12T09:00:00Z", event_payload: {} }],
      error: null,
    };
    results.admin_audit_events = {
      data: [{ id: "g1", event_type: "template.status_changed", actor_user_id: "u", actor_email: "ops@example.com", created_at: "2026-11-12T11:00:00Z", event_payload: {} }],
      error: null,
    };
    const body = await (await GET(req())).json();
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["global:g1", "a1"]);
    expect(body.events[0]).toMatchObject({ scope: "global", actor_id: "ops@example.com" });
  });

  it("surfaces a query failure as 500 with the message", async () => {
    results.audit_events = { data: null, error: { message: "boom" } };
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});

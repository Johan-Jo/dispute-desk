/**
 * Tests for POST /api/webhooks/shop/redact — GDPR mandatory
 * full-shop deletion 48h post-uninstall.
 *
 *   - 401 when HMAC fails
 *   - 200 with skipped:invalid_json on malformed body
 *   - 400 when shop domain missing
 *   - 200 with skipped:unknown_shop when shop isn't in our DB
 *     (idempotent — re-deliveries after the first cascade are no-ops)
 *   - 200 happy path: cascade deletes from every per-shop table in
 *     dependency order, returns deletedCounts
 *   - Per-table delete error (e.g. table doesn't exist) is logged but
 *     does NOT short-circuit the rest of the cascade
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { POST } from "@/app/api/webhooks/shop-redact/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);

interface ShopifySupabaseSpies {
  deleteCalls: Array<{ table: string; eqColumn: string; eqValue: string }>;
}

function setupSupabase(opts: {
  shopRow?: { id: string } | null;
  /** Tables that should return an error from delete (e.g. simulating
   *  a missing table). Default: none. */
  errorTables?: Set<string>;
  /** Per-table row count returned by .select() after delete. Default 0. */
  rowsByTable?: Record<string, number>;
}): ShopifySupabaseSpies {
  const deleteCalls: ShopifySupabaseSpies["deleteCalls"] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shops") {
      // shops.select for the lookup, then shops.delete in the cascade.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((_col: string, _val: string) => {
          return {
            maybeSingle: vi.fn().mockResolvedValue({
              data: opts.shopRow ?? null,
              error: null,
            }),
            select: vi.fn().mockResolvedValue({
              data: opts.errorTables?.has("shops")
                ? null
                : Array((opts.rowsByTable ?? {})["shops"] ?? 0).fill({ id: "x" }),
              error: opts.errorTables?.has("shops") ? { message: "shops missing", code: "42P01" } : null,
            }),
          };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn((col: string, val: string) => {
            deleteCalls.push({ table, eqColumn: col, eqValue: val });
            return {
              select: vi.fn().mockResolvedValue({
                data: opts.errorTables?.has(table)
                  ? null
                  : Array((opts.rowsByTable ?? {})[table] ?? 0).fill({ id: "x" }),
                error: opts.errorTables?.has(table)
                  ? { message: `${table} missing`, code: "42P01" }
                  : null,
              }),
            };
          }),
        })),
      };
    }
    // Every other table — just supports .delete().eq().select()
    return {
      delete: vi.fn(() => ({
        eq: vi.fn((col: string, val: string) => {
          deleteCalls.push({ table, eqColumn: col, eqValue: val });
          return {
            select: vi.fn().mockResolvedValue({
              data: opts.errorTables?.has(table)
                ? null
                : Array((opts.rowsByTable ?? {})[table] ?? 0).fill({ id: "x" }),
              error: opts.errorTables?.has(table)
                ? { message: `${table} missing`, code: "42P01" }
                : null,
            }),
          };
        }),
      })),
    };
  };

  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
  return { deleteCalls };
}

const PAYLOAD = JSON.stringify({
  shop_id: 12345,
  shop_domain: "demo.myshopify.com",
});

function makeReq(opts: { body: string; hmac?: string | null; shopHeader?: string | null }) {
  const headers: Record<string, string> = {};
  if (opts.hmac !== null && opts.hmac !== undefined) headers["x-shopify-hmac-sha256"] = opts.hmac;
  if (opts.shopHeader) headers["x-shopify-shop-domain"] = opts.shopHeader;
  return new NextRequest("http://localhost/api/webhooks/shop-redact", {
    method: "POST",
    body: opts.body,
    headers,
  });
}

describe("POST /api/webhooks/shop/redact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when HMAC fails (no DB calls)", async () => {
    mockVerify.mockReturnValue(false);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "bad" }));

    expect(res.status).toBe(401);
    expect(spies.deleteCalls.length).toBe(0);
  });

  it("returns 200 with skipped:invalid_json on malformed body", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(makeReq({ body: "not-json", hmac: "ok" }));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("invalid_json");
  });

  it("returns 400 when shop domain missing", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(makeReq({ body: "{}", hmac: "ok" }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with skipped:unknown_shop when shop isn't in our DB (idempotent re-delivery)", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: null });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("unknown_shop");
    expect(spies.deleteCalls.length).toBe(0);
  });

  it("happy path: cascade deletes from every per-shop table; final delete uses id= on shops", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.deletedCounts).toBe("object");

    // Every table got a delete call. Last call must be against the
    // shops table itself with id= (not shop_id=).
    expect(spies.deleteCalls.length).toBeGreaterThan(10);
    const last = spies.deleteCalls[spies.deleteCalls.length - 1];
    expect(last.table).toBe("shops");
    expect(last.eqColumn).toBe("id");
    expect(last.eqValue).toBe("shop-1");

    // Every other call should use shop_id=
    for (let i = 0; i < spies.deleteCalls.length - 1; i++) {
      expect(spies.deleteCalls[i].eqColumn).toBe("shop_id");
      expect(spies.deleteCalls[i].eqValue).toBe("shop-1");
    }
  });

  it("per-table error does NOT short-circuit the cascade — every other table still deleted", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({
      shopRow: { id: "shop-1" },
      // Simulate two tables that don't exist in this schema.
      errorTables: new Set(["shop_daily_metrics", "shop_reconcile_schedule"]),
    });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    const counts = (await res.json()).deletedCounts as Record<string, number>;
    expect(counts.shop_daily_metrics).toBe(-1); // -1 marks failure
    expect(counts.shop_reconcile_schedule).toBe(-1);
    // shops itself was still reached at the end
    expect(counts.shops).toBeGreaterThanOrEqual(0);
  });
});

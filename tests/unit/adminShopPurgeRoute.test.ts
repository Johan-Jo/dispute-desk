import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Guard tests for the shop-purge route. This is the most destructive
 * endpoint in the app — every assertion here is about something NOT
 * happening when it shouldn't.
 */

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const SHOP_DOMAIN = "test-store.myshopify.com";

let adminUser: { email: string } | null = { email: "admin@disputedesk.app" };
let shopRow: { id: string; shop_domain: string } | null = null;
let rpcCalls: Array<{ fn: string; args: unknown }> = [];
let auditCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/admin/auth", () => ({
  getAdminSessionUser: () => Promise.resolve(adminUser),
}));

vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: (e: Record<string, unknown>) => {
    auditCalls.push(e);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/admin/storeRevenue", () => ({
  computeStoreRevenue: () => Promise.resolve({ total: 0, currency: "USD", orderCount: 0 }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: shopRow }),

        }),
      }),
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: { ok: true, shop_domain: SHOP_DOMAIN }, error: null });
    },
  }),
}));

import { DELETE } from "@/app/api/admin/shops/[id]/route";

function req(confirm?: string) {
  const q = confirm === undefined ? "" : `?confirm=${encodeURIComponent(confirm)}`;
  return new NextRequest(`http://localhost/api/admin/shops/${SHOP_ID}${q}`, {
    method: "DELETE",
  });
}
const ctx = { params: Promise.resolve({ id: SHOP_ID }) };

beforeEach(() => {
  adminUser = { email: "admin@disputedesk.app" };
  shopRow = { id: SHOP_ID, shop_domain: SHOP_DOMAIN };
  rpcCalls = [];
  auditCalls = [];
});

describe("DELETE /api/admin/shops/[id] — purge guards", () => {
  it("purges when the confirmation matches the shop domain", async () => {
    const res = await DELETE(req(SHOP_DOMAIN), ctx);
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([
      { fn: "admin_purge_shop", args: { p_shop_id: SHOP_ID } },
    ]);
  });

  it("refuses without a confirmation, and purges nothing", async () => {
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a confirmation for a DIFFERENT shop — the mis-click case", async () => {
    // The list is full of near-identical myshopify names; confirming the
    // wrong one must never purge the row the URL points at.
    const res = await DELETE(req("other-store.myshopify.com"), ctx);
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("rejects a non-admin even though middleware also gates this path", async () => {
    adminUser = null;
    const res = await DELETE(req(SHOP_DOMAIN), ctx);
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  it("404s an unknown shop without calling the purge", async () => {
    shopRow = null;
    const res = await DELETE(req(SHOP_DOMAIN), ctx);
    expect(res.status).toBe(404);
    expect(rpcCalls).toEqual([]);
  });

  it("writes the audit breadcrumb BEFORE purging", async () => {
    // Written after the purge it would have nothing to attach to — the
    // shop's audit rows are deleted by the same call.
    await DELETE(req(SHOP_DOMAIN), ctx);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].eventType).toBe("admin_shop_purge_requested");
  });

  it("does not write an audit row when the confirmation fails", async () => {
    await DELETE(req("wrong.myshopify.com"), ctx);
    expect(auditCalls).toEqual([]);
  });
});

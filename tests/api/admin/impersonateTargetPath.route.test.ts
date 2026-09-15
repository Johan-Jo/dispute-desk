/**
 * The impersonation deep link ACTUALLY returns the requested page.
 *
 * WHY A ROUTE TEST. The Activity timeline's links were verified only by
 * checking that the destination URLs render under a hand-minted cookie — which
 * proves the pages exist, not that clicking a row reaches them. The chain that
 * matters is onClick -> POST /api/admin/impersonate {targetPath} -> targetUrl
 * -> window.open. This exercises the server half of that chain, which is the
 * half a unit test can reach; the browser half needs a real click.
 *
 * `targetPath` is also a caller-supplied redirect target, so the refusal cases
 * are the security-relevant ones.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const ADMIN = { id: "admin-1", email: "ops@example.com" };
const SHOP = {
  id: "6f62ee7a-66ba-452f-bb13-2e4baf44e4c0",
  shop_domain: "surasvenne.myshopify.com",
};

vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(async () => true),
  getAdminSessionUser: vi.fn(async () => ADMIN),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: SHOP }) }),
      }),
      insert: async () => ({ error: null }),
    }),
  }),
}));

vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn(async () => {}) }));

async function post(body: unknown) {
  const { POST } = await import("@/app/api/admin/impersonate/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("https://dev.disputedesk.app/api/admin/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.resetModules();
  process.env.CRON_SECRET = "test-secret-at-least-32-chars-long-xxxx";
});

describe("POST /api/admin/impersonate — targetPath", () => {
  it("returns the requested embedded page, not the dashboard", async () => {
    const { json } = await post({
      shopId: SHOP.id,
      mode: "read",
      targetPath: "/app/disputes/bbca3c19-584f-4f4b-b3e2-520b99df64c9",
    });
    expect(json.targetUrl).toBe(
      "/app/disputes/bbca3c19-584f-4f4b-b3e2-520b99df64c9",
    );
  });

  it("supports the non-dispute pages that have no admin equivalent", async () => {
    for (const p of ["/app/coverage", "/app/help", "/app/settings"]) {
      const { json } = await post({ shopId: SHOP.id, targetPath: p });
      expect(json.targetUrl).toBe(p);
    }
  });

  it("falls back to /app when no targetPath is given", async () => {
    const { json } = await post({ shopId: SHOP.id, mode: "read" });
    expect(json.targetUrl).toBe("/app");
  });

  it("refuses an absolute URL — this is a redirect target", async () => {
    const { json } = await post({
      shopId: SHOP.id,
      targetPath: "https://evil.example/steal",
    });
    expect(json.targetUrl).toBe("/app");
  });

  it("refuses a protocol-relative URL", async () => {
    const { json } = await post({
      shopId: SHOP.id,
      targetPath: "//evil.example/steal",
    });
    expect(json.targetUrl).toBe("/app");
  });

  it("refuses paths outside the embedded app", async () => {
    for (const p of ["/admin/shops", "/portal/billing", "/api/admin/team"]) {
      const { json } = await post({ shopId: SHOP.id, targetPath: p });
      expect(json.targetUrl).toBe("/app");
    }
  });
});

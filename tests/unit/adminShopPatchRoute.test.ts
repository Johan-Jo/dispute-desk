/**
 * PATCH /api/admin/shops/:id — the plan override writes `shops.plan`, which
 * gates features everywhere. It used to accept any string, ignored malformed
 * bodies with a 500, and audited the change as `system` (no operator).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const update = vi.fn();
const eq = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({ update: (u: unknown) => { update(u); return { eq: eq.mockResolvedValue({ error: null }) }; } }),
  }),
}));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin/storeRevenue", () => ({ computeStoreRevenue: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({
  getAdminSessionUser: vi.fn(async () => ({ email: "ops@example.com" })),
}));

import { PATCH } from "@/app/api/admin/shops/[id]/route";
import { logAuditEvent } from "@/lib/audit/logEvent";

const ctx = { params: Promise.resolve({ id: "shop-1" }) };
const patch = (body: unknown) =>
  PATCH({ json: async () => body } as never, ctx);

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/admin/shops/:id", () => {
  it("rejects an unknown plan without writing", async () => {
    const res = await patch({ plan: "enterprise-plus" });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a negative or fractional pack limit", async () => {
    expect((await patch({ pack_limit_override: -1 })).status).toBe(400);
    expect((await patch({ pack_limit_override: 1.5 })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400, not a 500", async () => {
    const res = await PATCH({ json: async () => { throw new Error("bad json"); } } as never, ctx);
    expect(res.status).toBe(400);
  });

  it("applies a valid override and audits it as the signed-in admin", async () => {
    const res = await patch({ plan: "growth", pack_limit_override: 50, admin_notes: "x" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ plan: "growth", pack_limit_override: 50 }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "admin", actorId: "ops@example.com", eventType: "admin_override" }),
    );
  });

  it("allows clearing the pack limit with null", async () => {
    expect((await patch({ pack_limit_override: null })).status).toBe(200);
  });
});

/**
 * Template status changes and reason-mapping edits are platform-wide (no shop).
 * They used to insert into audit_events, whose shop_id is NOT NULL, ignored the
 * failure, and left the trail empty. They now write admin_audit_events.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "admin_audit_events") return { insert };
      // pack_templates lookup used by the mapping route's validation
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: { status: "active" } }) }) }),
      };
    },
  }),
}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminSessionUser: vi.fn(async () => ({ id: "u1", email: "ops@example.com" })),
  hasAdminSession: vi.fn(async () => true),
}));
vi.mock("@/lib/db/templates", () => ({
  getTemplatePreview: vi.fn(),
  updateTemplateStatus: vi.fn(async () => ({ before: { status: "active" }, after: { status: "archived" } })),
}));
vi.mock("@/lib/db/reasonMappings", () => ({
  listReasonMappings: vi.fn(),
  getReasonMappingStats: vi.fn(),
  updateReasonMapping: vi.fn(async () => ({
    before: { reason_code: "FRAUDULENT", dispute_phase: "chargeback", template_id: null, is_active: true, notes: null },
    after: { template_id: "t1", is_active: true, notes: null },
  })),
}));

import { PATCH as templatePatch } from "@/app/api/admin/templates/[id]/route";
import { PATCH as mappingPatch } from "@/app/api/admin/reason-mapping/[id]/route";
import { logAdminAction } from "@/lib/admin/auditAction";

const ctx = { params: Promise.resolve({ id: "x1" }) };
const req = (body: unknown) => ({ json: async () => body }) as never;

beforeEach(() => {
  insert.mockReset();
  insert.mockResolvedValue({ error: null });
});

describe("global admin audit", () => {
  it("template status change is written to admin_audit_events with the operator", async () => {
    const res = await templatePatch(req({ status: "archived" }), ctx);
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_email: "ops@example.com",
        event_type: "template.status_changed",
        event_payload: expect.objectContaining({ template_id: "x1", after_status: "archived" }),
      }),
    );
  });

  it("reason-mapping edit is audited too", async () => {
    const res = await mappingPatch(req({ template_id: "t1" }), ctx);
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "reason_mapping.updated", actor_email: "ops@example.com" }),
    );
  });

  it("rejects malformed bodies with 400 instead of throwing", async () => {
    const bad = { json: async () => { throw new Error("bad"); } } as never;
    expect((await templatePatch(bad, ctx)).status).toBe(400);
    expect((await mappingPatch(bad, ctx)).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("logAdminAction reports a failed write instead of hiding it", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await logAdminAction({ actor: { email: "a@b.c" }, eventType: "x" })).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

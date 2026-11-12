/**
 * Admin team management. Granting, deactivating and revoking admins are the
 * most security-sensitive admin actions and were not audited; PATCH answered a
 * missing user with a 500 (the intended 404 was unreachable behind .single()).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const logAdminAction = vi.fn(async (_a: unknown) => true);
vi.mock("@/lib/admin/auditAction", () => ({ logAdminAction: (a: unknown) => logAdminAction(a) }));
vi.mock("@/lib/admin/auth", () => ({
  hasAdminSession: vi.fn(async () => true),
  getAdminSessionUser: vi.fn(async () => ({ id: "me", email: "me@example.com" })),
}));

type Resp = { data: unknown; error: { message: string; code?: string } | null };
let updateResp: Resp = { data: null, error: null };
let deleteResp: Resp = { data: [], error: null };
let insertResp: Resp = { data: null, error: null };
let rpcResp: Resp = { data: "uid-2", error: null };

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    rpc: async () => rpcResp,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "new@example.com" } } }) } },
    from: () => ({
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => updateResp }) }) }),
      delete: () => ({ eq: () => ({ select: async () => deleteResp }) }),
      insert: () => ({ select: () => ({ single: async () => insertResp }) }),
    }),
  }),
}));

import { PATCH, DELETE } from "@/app/api/admin/team/[id]/route";
import { POST } from "@/app/api/admin/team/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => ({ json: async () => body }) as never;

beforeEach(() => {
  logAdminAction.mockClear();
  updateResp = { data: null, error: null };
  deleteResp = { data: [], error: null };
  insertResp = { data: null, error: null };
  rpcResp = { data: "uid-2", error: null };
});

describe("team routes", () => {
  it("PATCH on an unknown user is a 404, not a 500", async () => {
    expect((await PATCH(json({ is_active: false }), ctx("ghost"))).status).toBe(404);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it("PATCH deactivates and audits the operator + target", async () => {
    updateResp = { data: { user_id: "u2", email: "a@b.c", is_active: false, last_login_at: null, created_at: "x", created_by: null }, error: null };
    const res = await PATCH(json({ is_active: false }), ctx("u2"));
    expect(res.status).toBe(200);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "team.deactivated", actor: { id: "me", email: "me@example.com" } }),
    );
  });

  it("cannot change or revoke your own access", async () => {
    expect((await PATCH(json({ is_active: false }), ctx("me"))).status).toBe(400);
    expect((await DELETE({} as never, ctx("me"))).status).toBe(400);
  });

  it("DELETE revokes, audits, and 404s when nothing was removed", async () => {
    expect((await DELETE({} as never, ctx("u2"))).status).toBe(404);
    deleteResp = { data: [{ email: "a@b.c" }], error: null };
    expect((await DELETE({} as never, ctx("u2"))).status).toBe(204);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ eventType: "team.revoked" }));
  });

  it("POST grants and audits; a malformed body is a 400", async () => {
    insertResp = { data: { user_id: "uid-2", email: "new@example.com", is_active: true, last_login_at: null, created_at: "x", created_by: "me@example.com" }, error: null };
    expect((await POST(json({ email: "new@example.com" }))).status).toBe(201);
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ eventType: "team.granted" }));
    const bad = { json: async () => { throw new Error("x"); } } as never;
    expect((await POST(bad)).status).toBe(400);
  });
});

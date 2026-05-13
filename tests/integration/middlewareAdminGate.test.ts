import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// `middleware.ts` imports `createServerClient` from `@supabase/ssr` and
// dynamic-imports `getServiceClient` from `@/lib/supabase/server`. Both
// are mocked here so the gate logic can be exercised in isolation
// without any real Supabase calls.

const mockGetUser = vi.fn();
const mockGrantSelect = vi.fn();
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "internal_admin_grants") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockGrantSelect,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in admin gate test: ${table}`);
    },
    rpc: mockRpc,
  }),
}));

// next-intl middleware swallows any unhandled root paths. Stub it to a
// noop NextResponse so unrelated logic in middleware.ts doesn't trip.
vi.mock("next-intl/middleware", () => ({
  default: () => () => {
    const { NextResponse } = require("next/server");
    return NextResponse.next();
  },
}));

// Ensure required env exists so `createServerClient(...)` invocation
// doesn't bail on missing env. The mocked factory ignores them.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

import { middleware } from "@/middleware";

function adminReq(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`), {
    headers: new Headers(),
  });
}

describe("middleware: /api/admin/* gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("returns 401 ADMIN_SESSION_REQUIRED when no Supabase user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(adminReq("/api/admin/disputes"));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("ADMIN_SESSION_REQUIRED");
  });

  it("returns 403 ADMIN_GRANT_REQUIRED when authed but no active grant", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "joe@example.com" } },
    });
    mockGrantSelect.mockResolvedValue({ data: null });
    const res = await middleware(adminReq("/api/admin/audit"));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("ADMIN_GRANT_REQUIRED");
  });

  it("passes through and touches last_login when authed with active grant", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "joe@example.com" } },
    });
    mockGrantSelect.mockResolvedValue({ data: { user_id: "user-1" } });
    const res = await middleware(adminReq("/api/admin/billing"));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("dd_admin_touch_last_login", {
      p_user_id: "user-1",
    });
  });

  it("allow-lists POST /api/admin/logout without auth", async () => {
    const res = await middleware(adminReq("/api/admin/logout"));
    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockGrantSelect).not.toHaveBeenCalled();
  });

  it("does NOT bypass for /api/admin/logout-something (=== check, not startsWith)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(adminReq("/api/admin/logout-extra"));
    expect(res.status).toBe(401);
  });
});

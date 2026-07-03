import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Supabase auth (session) + service client (grant + admin_passkeys).
const mockGetUser = vi.fn();
const mockGrantSelect = vi.fn();
const mockPasskeySelect = vi.fn();
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: (table: string) => {
      if (table === "internal_admin_grants") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockGrantSelect }) }) }),
        };
      }
      if (table === "admin_passkeys") {
        return {
          select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: mockPasskeySelect }) }) }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: mockRpc,
  }),
}));

vi.mock("next-intl/middleware", () => ({
  default: () => () => {
    const { NextResponse } = require("next/server");
    return NextResponse.next();
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.CRON_SECRET = "test-signing-secret";

import { middleware } from "@/middleware";
import { signPasskeyVerified, PASSKEY_COOKIE } from "@/lib/admin/passkeyCookie";

const USER = { id: "user-1", email: "admin@example.com" };

async function req(pathname: string, opts: { passkeyFor?: string } = {}): Promise<NextRequest> {
  const r = new NextRequest(new URL(`http://localhost${pathname}`), { headers: new Headers() });
  if (opts.passkeyFor) {
    r.cookies.set(
      PASSKEY_COOKIE,
      await signPasskeyVerified({
        userId: opts.passkeyFor,
        credentialId: "cred-1",
        iat: Math.floor(Date.now() / 1000),
      }),
    );
  }
  return r;
}

describe("middleware: /api/admin/* passkey gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockGrantSelect.mockResolvedValue({ data: { user_id: USER.id } });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("403 ADMIN_PASSKEY_REQUIRED when session+grant but no passkey cookie", async () => {
    const res = await middleware(await req("/api/admin/shops"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("ADMIN_PASSKEY_REQUIRED");
  });

  it("passes /api/admin/* with a valid passkey cookie for the same user", async () => {
    const res = await middleware(await req("/api/admin/shops", { passkeyFor: USER.id }));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("dd_admin_touch_last_login", { p_user_id: USER.id });
  });

  it("rejects a passkey cookie minted for a DIFFERENT user", async () => {
    const res = await middleware(await req("/api/admin/shops", { passkeyFor: "someone-else" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("ADMIN_PASSKEY_REQUIRED");
  });

  it("allow-lists the passkey ceremony routes at session+grant (no passkey cookie)", async () => {
    const reg = await middleware(await req("/api/admin/passkeys/register"));
    expect(reg.status).toBe(200);
    const auth = await middleware(await req("/api/admin/passkeys/authenticate"));
    expect(auth.status).toBe(200);
  });

  it("keeps logout open without passkey", async () => {
    const res = await middleware(await req("/api/admin/logout"));
    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

describe("middleware: /admin/* page passkey gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: USER } });
    mockGrantSelect.mockResolvedValue({ data: { user_id: USER.id } });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("redirects to enroll when grant + no passkey credential in DB", async () => {
    mockPasskeySelect.mockResolvedValue({ data: null });
    const res = await middleware(await req("/admin/shops"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/enroll-passkey");
  });

  it("redirects to verify when a credential exists but no verified cookie", async () => {
    mockPasskeySelect.mockResolvedValue({ data: { id: "pk-1" } });
    const res = await middleware(await req("/admin/shops"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/admin/verify-passkey");
  });

  it("allows /admin/* with a valid passkey cookie", async () => {
    const res = await middleware(await req("/admin/shops", { passkeyFor: USER.id }));
    expect(res.status).toBe(200);
  });

  it("allow-lists enroll + verify pages without a passkey cookie", async () => {
    const enroll = await middleware(await req("/admin/enroll-passkey"));
    expect(enroll.status).toBe(200);
    const verify = await middleware(await req("/admin/verify-passkey"));
    expect(verify.status).toBe(200);
  });
});

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Supabase so the non-impersonation branches don't hit the network.
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => ({ data: null }) }),
      }),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
import {
  signImpersonation,
  IMPERSONATION_COOKIE,
  IMPERSONATION_MODE_HEADER,
} from "@/lib/admin/impersonation";

async function reqWith(
  pathname: string,
  method: string,
  cookieValue?: string,
): Promise<NextRequest> {
  const url = new URL(`http://localhost${pathname}`);
  const req = new NextRequest(url, { method });
  if (cookieValue) req.cookies.set(IMPERSONATION_COOKIE, cookieValue);
  return req;
}

async function cookie(mode: "read" | "write"): Promise<string> {
  return signImpersonation({
    shopId: "shop-1",
    shopDomain: "acme.myshopify.com",
    mode,
    adminUserId: "admin-1",
    iat: Math.floor(Date.now() / 1000),
  });
}

describe("middleware: impersonation short-circuit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects x-shop-id on a GET /api/* with a valid read cookie", async () => {
    const res = await middleware(
      await reqWith("/api/disputes", "GET", await cookie("read")),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-shop-id")).toBe("shop-1");
    expect(res.headers.get(`x-middleware-request-${IMPERSONATION_MODE_HEADER}`)).toBe(
      "read",
    );
  });

  it("blocks a non-GET /api/* in read mode with 403 IMPERSONATION_READ_ONLY", async () => {
    const res = await middleware(
      await reqWith("/api/disputes/123/approve", "POST", await cookie("read")),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("IMPERSONATION_READ_ONLY");
  });

  it("allows a non-GET /api/* in write mode", async () => {
    const res = await middleware(
      await reqWith("/api/disputes/123/approve", "POST", await cookie("write")),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-shop-id")).toBe("shop-1");
  });

  it("renders /app/* with shop headers and no App Bridge under impersonation", async () => {
    const res = await middleware(await reqWith("/app", "GET", await cookie("read")));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-shop-id")).toBe("shop-1");
    expect(res.headers.get("x-middleware-request-x-dd-load-app-bridge")).toBe("0");
    expect(res.headers.get(`x-middleware-request-${IMPERSONATION_MODE_HEADER}`)).toBe(
      "read",
    );
  });

  it("does NOT short-circuit /api/admin/* (admin mint/exit stays gated)", async () => {
    // /api/admin/* runs its own gate BEFORE the impersonation block. With no
    // Supabase user, expect the admin 401 — not an impersonation pass-through.
    const res = await middleware(
      await reqWith("/api/admin/impersonate", "POST", await cookie("write")),
    );
    expect(res.status).toBe(401);
  });

  it("ignores a tampered cookie (falls through to normal auth)", async () => {
    const good = await cookie("read");
    const tampered = `${good.slice(0, -3)}xyz`;
    const res = await middleware(await reqWith("/api/disputes", "GET", tampered));
    // No valid impersonation → normal embedded API path → SESSION_REQUIRED 401.
    expect(res.status).toBe(401);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("SESSION_REQUIRED");
  });
});

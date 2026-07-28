/**
 * Contract tests for GET|PUT /api/automation/store — the ONE route for the
 * store-wide handling switch. Covers validation, the plan gate, and the
 * deliberate setup exemption that lets free-plan merchants pick their mode
 * during onboarding.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/rules/storeAutomation", () => ({
  readStoreAutomation: vi.fn(),
  writeStoreAutomation: vi.fn(),
}));
vi.mock("@/lib/billing/checkQuota", () => ({ checkFeatureAccess: vi.fn() }));

import { getServiceClient } from "@/lib/supabase/server";
import { readStoreAutomation, writeStoreAutomation } from "@/lib/rules/storeAutomation";
import { checkFeatureAccess } from "@/lib/billing/checkQuota";
import { GET, PUT } from "@/app/api/automation/store/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockRead = vi.mocked(readStoreAutomation);
const mockWrite = vi.mocked(writeStoreAutomation);
const mockAccess = vi.mocked(checkFeatureAccess);

function sbWithPlan(plan: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { plan }, error: null }),
        }),
      }),
    }),
  };
}

function makeReq(
  method: "GET" | "PUT",
  opts: { body?: unknown; headers?: Record<string, string>; shopId?: string } = {},
) {
  const shopId = opts.shopId ?? "shop-1";
  const url = `https://x.test/api/automation/store?shop_id=${shopId}`;
  return {
    method,
    nextUrl: new URL(url),
    headers: new Headers(opts.headers ?? {}),
    cookies: { get: () => undefined },
    json: async () => opts.body,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServiceClient.mockReturnValue(sbWithPlan("growth") as never);
  mockAccess.mockReturnValue({ allowed: true } as never);
  mockRead.mockResolvedValue({
    mode: "auto",
    safeguard: { enabled: true, amount: 500 },
  });
  mockWrite.mockImplementation(async (_shopId, next) => next);
});

describe("GET /api/automation/store", () => {
  it("returns the config plus the plan-access flag", async () => {
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "auto",
      safeguard: { enabled: true, amount: 500 },
      rulesAccess: { allowed: true, reason: null },
    });
  });

  it("returns 200 with allowed=false on a gated plan (a FLAG, never a 403)", async () => {
    // The UI must still be able to render the current setting read-only.
    mockAccess.mockReturnValue({ allowed: false, reason: "upgrade" } as never);
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).rulesAccess).toEqual({
      allowed: false,
      reason: "upgrade",
    });
  });

  it("400s without a shop id", async () => {
    const req = {
      method: "GET",
      nextUrl: new URL("https://x.test/api/automation/store"),
      headers: new Headers(),
      cookies: { get: () => undefined },
    } as never;
    expect((await GET(req)).status).toBe(400);
  });
});

describe("PUT /api/automation/store", () => {
  it("persists a valid auto + safeguard payload", async () => {
    const res = await PUT(
      makeReq("PUT", {
        body: { mode: "auto", safeguard: { enabled: true, amount: 750 } },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("shop-1", {
      mode: "auto",
      safeguard: { enabled: true, amount: 750 },
    });
  });

  it("persists review with the safeguard off", async () => {
    const res = await PUT(
      makeReq("PUT", { body: { mode: "review", safeguard: { enabled: false } } }),
    );
    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("shop-1", {
      mode: "review",
      safeguard: { enabled: false, amount: 0 },
    });
  });

  it("400s on an unknown mode", async () => {
    const res = await PUT(makeReq("PUT", { body: { mode: "automated" } }));
    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("400s when the safeguard is enabled with a non-positive amount", async () => {
    const res = await PUT(
      makeReq("PUT", {
        body: { mode: "auto", safeguard: { enabled: true, amount: 0 } },
      }),
    );
    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("400s when the safeguard amount is not a number", async () => {
    const res = await PUT(
      makeReq("PUT", {
        body: { mode: "auto", safeguard: { enabled: true, amount: "500" } },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("403s on a gated plan", async () => {
    mockAccess.mockReturnValue({ allowed: false, reason: "upgrade" } as never);
    const res = await PUT(
      makeReq("PUT", { body: { mode: "auto", safeguard: { enabled: false } } }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).upgrade_required).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("SKIPS the plan gate for a setup-originated write", async () => {
    // A free-plan merchant must be able to choose their handling mode during
    // onboarding — they are seeded auto-pilot at install anyway, so gating the
    // wizard would only produce a dead-end first-run screen.
    mockAccess.mockReturnValue({ allowed: false, reason: "upgrade" } as never);
    const res = await PUT(
      makeReq("PUT", {
        body: { mode: "review", safeguard: { enabled: false } },
        headers: { "x-dd-setup": "1" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalled();
  });

  it("400s on malformed JSON", async () => {
    const req = {
      method: "PUT",
      nextUrl: new URL("https://x.test/api/automation/store?shop_id=shop-1"),
      headers: new Headers(),
      cookies: { get: () => undefined },
      json: async () => {
        throw new Error("bad json");
      },
    } as never;
    expect((await PUT(req)).status).toBe(400);
  });
});

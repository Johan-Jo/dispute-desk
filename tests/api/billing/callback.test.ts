import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/queries/appChargeStatus", () => ({
  verifyAppCharge: vi.fn(),
}));
vi.mock("@/lib/billing/consumePack", () => ({
  grantCredits: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyAppCharge } from "@/lib/shopify/queries/appChargeStatus";
import { grantCredits } from "@/lib/billing/consumePack";
import { GET } from "@/app/api/billing/callback/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyAppCharge);
const mockGrant = vi.mocked(grantCredits);

function makeSb() {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const updates: Array<{ table: string; patch: unknown }> = [];
  const upserts: Array<{ table: string; row: unknown }> = [];

  const sb = {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (row: unknown) => {
        inserts.push({ table, row });
        return { data: null, error: null };
      }),
      update: vi.fn((patch: unknown) => {
        updates.push({ table, patch });
        return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }),
      upsert: vi.fn(async (row: unknown) => {
        upserts.push({ table, row });
        return { data: null, error: null };
      }),
      select: vi.fn(),
    })),
  };
  return { sb, inserts, updates, upserts };
}

function makeReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/billing/callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHOPIFY_APP_URL = "http://localhost";
});

describe("GET /api/billing/callback", () => {
  it("redirects without verify when charge_id is missing (declined)", async () => {
    const { sb, inserts } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);

    const res = await GET(makeReq({ shop_id: "shop-1", plan_id: "starter" }));

    expect(res.status).toBe(307); // NextResponse.redirect
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
    const types = inserts.map((i) => (i.row as { event_type: string }).event_type);
    expect(types).toContain("billing_declined");
  });

  it("does NOT grant when verify returns not_active", async () => {
    const { sb, inserts, upserts, updates } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockVerify.mockResolvedValue({
      verified: false,
      status: "PENDING",
      reason: "not_active",
    });

    const res = await GET(
      makeReq({ shop_id: "shop-1", plan_id: "starter", charge_id: "111" }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location") ?? "").toContain("verify_failed=not_active");
    expect(mockGrant).not.toHaveBeenCalled();
    // No shops.update, no plan_entitlements.upsert
    expect(updates).toHaveLength(0);
    expect(upserts).toHaveLength(0);
    const types = inserts.map((i) => (i.row as { event_type: string }).event_type);
    expect(types).toContain("billing_verification_failed");
    expect(types).not.toContain("billing_activated");
  });

  it("upgrades plan + grants credits when verify succeeds", async () => {
    const { sb, inserts, upserts, updates } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockVerify.mockResolvedValue({
      verified: true,
      status: "ACTIVE",
      rawAmountUsd: 29,
      shopifyChargeGid: "gid://shopify/AppSubscription/111",
      test: false,
    });

    const res = await GET(
      makeReq({ shop_id: "shop-1", plan_id: "starter", charge_id: "111" }),
    );

    expect(res.status).toBe(307);
    expect(updates.some((u) => u.table === "shops")).toBe(true);
    expect(upserts.some((u) => u.table === "plan_entitlements")).toBe(true);
    expect(mockGrant).toHaveBeenCalled();
    const auditRow = inserts.find(
      (i) => (i.row as { event_type: string }).event_type === "billing_activated",
    )?.row as { event_payload: { charge_verified: boolean } } | undefined;
    expect(auditRow?.event_payload.charge_verified).toBe(true);
  });
});

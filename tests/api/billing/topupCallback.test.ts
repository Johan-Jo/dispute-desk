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
import { GET } from "@/app/api/billing/topup-callback/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyAppCharge);
const mockGrant = vi.mocked(grantCredits);

function makeSb() {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const sb = {
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (row: unknown) => {
        inserts.push({ table, row });
        return { data: null, error: null };
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { billing_cycle_ends_at: null }, error: null }),
        }),
      }),
    })),
  };
  return { sb, inserts };
}

function makeReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/billing/topup-callback");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHOPIFY_APP_URL = "http://localhost";
});

describe("GET /api/billing/topup-callback", () => {
  it("does NOT grant when verify returns not_active", async () => {
    const { sb, inserts } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockVerify.mockResolvedValue({
      verified: false,
      status: "PENDING",
      reason: "not_active",
    });

    const res = await GET(
      makeReq({ shop_id: "shop-1", sku: "topup_10", charge_id: "111" }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location") ?? "").toContain("verify_failed=not_active");
    expect(mockGrant).not.toHaveBeenCalled();
    const types = inserts.map((i) => (i.row as { event_type: string }).event_type);
    expect(types).toContain("topup_verification_failed");
    expect(types).not.toContain("topup_purchased");
  });

  it("grants credits when verify succeeds", async () => {
    const { sb, inserts } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockVerify.mockResolvedValue({
      verified: true,
      status: "ACTIVE",
      rawAmountUsd: 19,
      shopifyChargeGid: "gid://shopify/AppPurchaseOneTime/111",
      test: false,
    });

    const res = await GET(
      makeReq({ shop_id: "shop-1", sku: "topup_10", charge_id: "111" }),
    );

    expect(res.status).toBe(307);
    expect(mockGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        source: "topup",
        reference: "topup_topup_10_111",
      }),
    );
    const auditRow = inserts.find(
      (i) => (i.row as { event_type: string }).event_type === "topup_purchased",
    )?.row as { event_payload: { charge_verified: boolean } } | undefined;
    expect(auditRow?.event_payload.charge_verified).toBe(true);
  });

  it("top-up expires 30 days from purchase, independent of billing cycle", async () => {
    // Even when the entitlement's cycle ends in one hour, the
    // top-up grant should NOT inherit that cycle-end. Top-ups are
    // decoupled from the monthly cycle as of 2026-05-15.
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sb = {
      from: vi.fn((table: string) => ({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { billing_cycle_ends_at: oneHourFromNow },
              error: null,
            }),
          }),
        }),
      })),
    };
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockVerify.mockResolvedValue({
      verified: true,
      status: "ACTIVE",
      rawAmountUsd: 79,
      shopifyChargeGid: "gid://shopify/AppPurchaseOneTime/222",
      test: false,
    });

    const before = Date.now();
    await GET(
      makeReq({ shop_id: "shop-1", sku: "topup_50", charge_id: "222" }),
    );
    const after = Date.now();

    expect(mockGrant).toHaveBeenCalledTimes(1);
    const grantCall = mockGrant.mock.calls[0][0];
    const expiresAtMs = new Date(grantCall.expiresAt as string).getTime();
    const minExpected = before + 30 * 24 * 60 * 60 * 1000;
    const maxExpected = after + 30 * 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(minExpected);
    expect(expiresAtMs).toBeLessThanOrEqual(maxExpected);
    // The cycle-end-aliased expiry would have been ~1 hour from now;
    // the new behavior must be far past it.
    expect(expiresAtMs).toBeGreaterThan(new Date(oneHourFromNow).getTime());
  });

  it("redirects without verify when charge_id is missing", async () => {
    const { sb } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);

    const res = await GET(makeReq({ shop_id: "shop-1", sku: "topup_10" }));

    expect(res.status).toBe(307);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockGrant).not.toHaveBeenCalled();
  });
});

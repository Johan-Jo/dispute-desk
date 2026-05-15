import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/shopify/checkReasonEnumDrift", () => ({
  checkShopifyReasonEnumDrift: vi.fn(),
}));
vi.mock("@/lib/shopify/checkQueryFieldDrift", () => ({
  checkShopifyQueryFieldDrift: vi.fn(),
}));

import { checkShopifyReasonEnumDrift } from "@/lib/shopify/checkReasonEnumDrift";
import { checkShopifyQueryFieldDrift } from "@/lib/shopify/checkQueryFieldDrift";
import { GET } from "@/app/api/cron/check-shopify-reasons/route";

const mockEnum = vi.mocked(checkShopifyReasonEnumDrift);
const mockField = vi.mocked(checkShopifyQueryFieldDrift);

function makeReq(secret?: string): Parameters<typeof GET>[0] {
  return {
    headers: {
      get: (name: string) => {
        if (name === "authorization" && secret) return `Bearer ${secret}`;
        return null;
      },
    },
    nextUrl: {
      searchParams: {
        get: (_: string) => null,
      },
    },
  } as unknown as Parameters<typeof GET>[0];
}

const CLEAN_FIELD_RESULT = {
  ok: true as const,
  drift: false as const,
  checkedShopDomain: "test.myshopify.com",
  queriesChecked: 8,
};

describe("GET /api/cron/check-shopify-reasons", () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    // Default both helpers to clean so tests that only care about one
    // path don't need to wire the other.
    mockField.mockResolvedValue(CLEAN_FIELD_RESULT);
  });

  afterAll(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(mockEnum).not.toHaveBeenCalled();
    expect(mockField).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret is wrong", async () => {
    const res = await GET(makeReq("wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockEnum).not.toHaveBeenCalled();
    expect(mockField).not.toHaveBeenCalled();
  });

  it("returns 200 with both checks clean", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      drift: false,
      enumTotalCount: 14,
      checkedShopDomain: "test.myshopify.com",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enum.drift).toBe(false);
    expect(json.queryField.drift).toBe(false);
    expect(mockEnum).toHaveBeenCalledTimes(1);
    expect(mockField).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with alertSent=true for new enum drift", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      drift: true,
      alertSent: true,
      missingLocally: ["NEW_SHOPIFY_REASON"],
      extraLocally: [],
      checkedShopDomain: "test.myshopify.com",
      enumTotalCount: 15,
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enum.drift).toBe(true);
    expect(json.enum.alertSent).toBe(true);
    expect(json.enum.missingLocally).toEqual(["NEW_SHOPIFY_REASON"]);
  });

  it("returns 200 with alertSent=true for new query-field drift", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      drift: false,
      enumTotalCount: 14,
      checkedShopDomain: "test.myshopify.com",
    });
    mockField.mockResolvedValue({
      ok: true,
      drift: true,
      alertSent: true,
      driftRows: [
        {
          query: "ORDER_DETAIL_QUERY",
          type: "Order",
          field: "cartToken",
          message: "Field 'cartToken' doesn't exist on type 'Order'",
        },
      ],
      checkedShopDomain: "test.myshopify.com",
      queriesChecked: 8,
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queryField.drift).toBe(true);
    expect(json.queryField.alertSent).toBe(true);
    expect(json.queryField.driftRows[0].field).toBe("cartToken");
  });

  it("returns 200 with dedup=already_alerted when enum diff is unchanged", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      drift: true,
      dedup: "already_alerted",
      missingLocally: ["NEW_SHOPIFY_REASON"],
      extraLocally: [],
      checkedShopDomain: "test.myshopify.com",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enum.drift).toBe(true);
    expect(json.enum.dedup).toBe("already_alerted");
  });

  it("returns 200 with skipped=no_connected_shop on both checks when no shop", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      skipped: "no_connected_shop",
    });
    mockField.mockResolvedValue({
      ok: true,
      skipped: "no_connected_shop",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enum.skipped).toBe("no_connected_shop");
    expect(json.queryField.skipped).toBe("no_connected_shop");
  });

  it("returns 200 with drift=false, resolved=true when previous enum drift is now clean", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      drift: false,
      resolved: true,
      previousMissingLocally: ["NEW_SHOPIFY_REASON"],
      previousExtraLocally: [],
      enumTotalCount: 14,
      checkedShopDomain: "test.myshopify.com",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enum.drift).toBe(false);
    expect(json.enum.resolved).toBe(true);
  });

  it("returns 500 when the enum helper reports introspection_failed", async () => {
    mockEnum.mockResolvedValue({
      ok: false,
      error: "introspection_failed",
      message: "fetch timed out",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.enum.ok).toBe(false);
    expect(json.enum.error).toBe("introspection_failed");
    // queryField check still ran successfully and is reported alongside.
    expect(json.queryField.ok).toBe(true);
  });

  it("returns 500 when the query-field helper reports check_failed", async () => {
    mockEnum.mockResolvedValue({
      ok: true,
      drift: false,
      enumTotalCount: 14,
      checkedShopDomain: "test.myshopify.com",
    });
    mockField.mockResolvedValue({
      ok: false,
      error: "check_failed",
      message: "transport blew up",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.queryField.ok).toBe(false);
    expect(json.queryField.error).toBe("check_failed");
  });
});

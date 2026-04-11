import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("@/lib/shopify/checkReasonEnumDrift", () => ({
  checkShopifyReasonEnumDrift: vi.fn(),
}));

import { checkShopifyReasonEnumDrift } from "@/lib/shopify/checkReasonEnumDrift";
import { GET } from "@/app/api/cron/check-shopify-reasons/route";

const mockCheck = vi.mocked(checkShopifyReasonEnumDrift);

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

describe("GET /api/cron/check-shopify-reasons", () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });

  afterAll(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("returns 401 when the secret is wrong", async () => {
    const res = await GET(makeReq("wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("returns 200 with drift=false for a clean run", async () => {
    mockCheck.mockResolvedValue({
      ok: true,
      drift: false,
      enumTotalCount: 14,
      checkedShopDomain: "test.myshopify.com",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.drift).toBe(false);
    expect(json.enumTotalCount).toBe(14);
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with alertSent=true when new drift is detected", async () => {
    mockCheck.mockResolvedValue({
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
    expect(json.drift).toBe(true);
    expect(json.alertSent).toBe(true);
    expect(json.missingLocally).toEqual(["NEW_SHOPIFY_REASON"]);
  });

  it("returns 200 with dedup=already_alerted when the diff is unchanged", async () => {
    mockCheck.mockResolvedValue({
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
    expect(json.drift).toBe(true);
    expect(json.dedup).toBe("already_alerted");
    // The route doesn't fire email itself — the helper does / skips.
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with skipped=no_connected_shop when there's no shop", async () => {
    mockCheck.mockResolvedValue({
      ok: true,
      skipped: "no_connected_shop",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe("no_connected_shop");
  });

  it("returns 500 when the helper reports introspection_failed", async () => {
    mockCheck.mockResolvedValue({
      ok: false,
      error: "introspection_failed",
      message: "fetch timed out",
    });
    const res = await GET(makeReq("test-secret"));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("introspection_failed");
    expect(json.message).toBe("fetch timed out");
  });
});

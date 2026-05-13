import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shopify/sessions/getShopBackgroundSession", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/shopify/sessions/getShopBackgroundSession")
  >("@/lib/shopify/sessions/getShopBackgroundSession");
  return {
    ...actual,
    getShopBackgroundSession: vi.fn(),
  };
});

vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn(),
}));

import {
  getShopBackgroundSession,
  NoBackgroundSessionError,
} from "@/lib/shopify/sessions/getShopBackgroundSession";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { verifyAppCharge } from "../appChargeStatus";

const mockGetSession = vi.mocked(getShopBackgroundSession);
const mockGraphQL = vi.mocked(requestShopifyGraphQL);

const SHOP_ID = "shop-1";
const SESSION = {
  id: "sess-1",
  shopId: SHOP_ID,
  sessionType: "offline" as const,
  userId: null,
  shopDomain: "test.myshopify.com",
  accessToken: "tok",
  scopes: "",
  expiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
});

function subResponse(opts: {
  status: string;
  amount?: string;
  currency?: string;
  test?: boolean;
}) {
  return {
    data: {
      node: {
        __typename: "AppSubscription",
        id: "gid://shopify/AppSubscription/1",
        status: opts.status,
        test: opts.test ?? false,
        lineItems: [
          {
            plan: {
              pricingDetails: {
                __typename: "AppRecurringPricing",
                price: {
                  amount: opts.amount ?? "29.00",
                  currencyCode: opts.currency ?? "USD",
                },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  };
}

function oneTimeResponse(opts: {
  status: string;
  amount?: string;
  currency?: string;
  test?: boolean;
}) {
  return {
    data: {
      node: {
        __typename: "AppPurchaseOneTime",
        id: "gid://shopify/AppPurchaseOneTime/1",
        status: opts.status,
        test: opts.test ?? false,
        price: {
          amount: opts.amount ?? "19.00",
          currencyCode: opts.currency ?? "USD",
        },
      },
    },
  };
}

describe("verifyAppCharge", () => {
  it("verified=true for subscription ACTIVE + matching price + USD", async () => {
    mockGraphQL.mockResolvedValue(subResponse({ status: "ACTIVE", amount: "29.00" }));
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(true);
    expect(r.status).toBe("ACTIVE");
    expect(r.shopifyChargeGid).toBe("gid://shopify/AppSubscription/111");
  });

  it("subscription PENDING → reason not_active", async () => {
    mockGraphQL.mockResolvedValue(subResponse({ status: "PENDING" }));
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("not_active");
    expect(r.status).toBe("PENDING");
  });

  it("subscription DECLINED → reason not_active", async () => {
    mockGraphQL.mockResolvedValue(subResponse({ status: "DECLINED" }));
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("not_active");
  });

  it("subscription with wrong __typename → reason wrong_type", async () => {
    mockGraphQL.mockResolvedValue({
      data: {
        node: {
          __typename: "AppPurchaseOneTime",
          id: "gid://shopify/AppPurchaseOneTime/1",
          status: "ACTIVE",
          test: false,
          price: { amount: "29.00", currencyCode: "USD" },
        },
      },
    });
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("wrong_type");
  });

  it("subscription price mismatch → reason price_mismatch", async () => {
    mockGraphQL.mockResolvedValue(subResponse({ status: "ACTIVE", amount: "19.00" }));
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("price_mismatch");
    expect(r.rawAmountUsd).toBe(19);
  });

  it("subscription non-USD currency → reason currency_mismatch", async () => {
    mockGraphQL.mockResolvedValue(
      subResponse({ status: "ACTIVE", amount: "29.00", currency: "EUR" }),
    );
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("currency_mismatch");
  });

  it("one-time ACTIVE + matching price → verified", async () => {
    mockGraphQL.mockResolvedValue(oneTimeResponse({ status: "ACTIVE", amount: "19.00" }));
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "222",
      chargeType: "one_time",
      expectedAmountUsd: 19,
    });
    expect(r.verified).toBe(true);
    expect(r.shopifyChargeGid).toBe("gid://shopify/AppPurchaseOneTime/222");
  });

  it("node = null → reason node_not_found", async () => {
    mockGraphQL.mockResolvedValue({ data: { node: null } });
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("node_not_found");
  });

  it("GraphQL errors present → reason shopify_error", async () => {
    mockGraphQL.mockResolvedValue({
      data: { node: null },
      errors: [{ message: "Throttled" }],
    });
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("shopify_error");
  });

  it("NoBackgroundSessionError → reason no_session", async () => {
    mockGetSession.mockRejectedValue(new NoBackgroundSessionError(SHOP_ID));
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("no_session");
  });

  it("accepts a full GID as input verbatim", async () => {
    mockGraphQL.mockResolvedValue(subResponse({ status: "ACTIVE" }));
    const fullGid = "gid://shopify/AppSubscription/9999";
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: fullGid,
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(true);
    expect(r.shopifyChargeGid).toBe(fullGid);
    expect(mockGraphQL).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { id: fullGid },
      }),
    );
  });

  it("flags test_charge in result on test-mode subscription", async () => {
    mockGraphQL.mockResolvedValue(
      subResponse({ status: "ACTIVE", amount: "29.00", test: true }),
    );
    const r = await verifyAppCharge({
      shopId: SHOP_ID,
      chargeId: "111",
      chargeType: "subscription",
      expectedAmountUsd: 29,
    });
    expect(r.verified).toBe(true);
    expect(r.test).toBe(true);
  });
});

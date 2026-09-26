import { afterEach, describe, expect, it, vi } from "vitest";

const makeAuthedRequest = vi.fn();
vi.mock("@/lib/shopify/makeAuthedRequest", () => ({ makeAuthedRequest: (...a: unknown[]) => makeAuthedRequest(...a) }));
const callClaudeMessages = vi.fn();
vi.mock("../../anthropicClient", () => ({ callClaudeMessages: (...a: unknown[]) => callClaudeMessages(...a) }));

import { counselEnabled, fetchCustomerOrders, runCounsel } from "../run";

afterEach(() => {
  delete process.env.DEFENCE_COUNSEL_V2;
  makeAuthedRequest.mockReset();
  callClaudeMessages.mockReset();
});

describe("counsel v2 in the package job", () => {
  it("runs for item-not-received only, with a kill switch", () => {
    expect(counselEnabled("inr_product_not_received")).toBe(true);
    expect(counselEnabled("visa_10_4_fraud")).toBe(false);
    process.env.DEFENCE_COUNSEL_V2 = "off";
    expect(counselEnabled("inr_product_not_received")).toBe(false);
  });

  it("maps the customer's orders from the Admin API", async () => {
    makeAuthedRequest.mockResolvedValue({
      data: {
        order: {
          customer: {
            orders: {
              edges: [
                {
                  node: {
                    name: "#363341",
                    createdAt: "2026-09-05T03:04:27Z",
                    cancelledAt: null,
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "FULFILLED",
                    totalPriceSet: { presentmentMoney: { amount: "109.67", currencyCode: "CAD" } },
                    transactions: [{ kind: "SALE", status: "SUCCESS", paymentDetails: { number: "•••• •••• •••• 3627", wallet: "APPLE_PAY" } }],
                    fulfillments: [{ deliveredAt: "2026-09-21T19:42:52Z", trackingInfo: [{ company: "Stallion Express" }] }],
                  },
                },
              ],
            },
          },
        },
      },
    });
    expect(await fetchCustomerOrders("shop", "gid://shopify/Order/1")).toEqual([
      {
        name: "#363341",
        createdAt: "2026-09-05T03:04:27Z",
        financialStatus: "PAID",
        fulfillmentStatus: "FULFILLED",
        cancelled: false,
        deliveredAt: "2026-09-21T19:42:52Z",
        carrier: "Stallion Express",
        cardLast4: "3627",
        wallet: "APPLE_PAY",
        total: "CAD 109.67",
      },
    ]);
  });

  it("reads no orders when the Admin call fails (the ledger just has no later order)", async () => {
    makeAuthedRequest.mockRejectedValue(new Error("no session"));
    expect(await fetchCustomerOrders("shop", "gid://shopify/Order/1")).toEqual([]);
  });

  it("returns null without a model call when there is no carrier-confirmed delivery", async () => {
    makeAuthedRequest.mockResolvedValue({ data: { order: { customer: null } } });
    const res = await runCounsel({
      shopId: "shop",
      moduleKey: "inr_product_not_received",
      facts: [],
      packSections: [],
      orderName: "#1",
      orderGid: "gid://shopify/Order/1",
      disputeGid: null,
      disputeOpenedAt: null,
      disputeAmount: null,
      disputeCurrency: null,
      amountDisplay: null,
      cardLast4: null,
      merchantName: "Blume",
    });
    expect(res).toBeNull();
    expect(callClaudeMessages).not.toHaveBeenCalled();
  });
});

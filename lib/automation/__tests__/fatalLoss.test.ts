/**
 * Fatal-loss detector tests (PRD v1.1 §5).
 * Pure function — no mocking required.
 */

import { describe, it, expect } from "vitest";
import { detectFatalLoss } from "../fatalLoss";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

function makeOrder(overrides: Partial<OrderDetailNode> = {}): OrderDetailNode {
  return {
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    fulfillments: [],
    displayFulfillmentStatus: "FULFILLED",
    ...overrides,
  } as OrderDetailNode;
}

describe("detectFatalLoss — refund_issued trigger", () => {
  it("fires when totalRefunded covers disputed amount exactly", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    });
    const r = detectFatalLoss(order, "FRAUDULENT", 100);
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("refund_issued");
    expect(r.message).toMatch(/refund/i);
  });

  it("fires when totalRefunded exceeds disputed amount", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "150.00", currencyCode: "USD" } },
    });
    expect(detectFatalLoss(order, "FRAUDULENT", 100).triggered).toBe(true);
  });

  it("does NOT fire when refund covers less than disputed amount (partial refund)", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "40.00", currencyCode: "USD" } },
    });
    expect(detectFatalLoss(order, "FRAUDULENT", 100).triggered).toBe(false);
  });

  it("does NOT fire when no refund has been issued", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    });
    expect(detectFatalLoss(order, "FRAUDULENT", 100).triggered).toBe(false);
  });

  it("does NOT fire when disputeAmount is null (legacy disputes — avoid false positives)", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    });
    expect(detectFatalLoss(order, "FRAUDULENT", null).triggered).toBe(false);
  });

  it("does NOT fire when disputeAmount is 0 (no real charge)", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    });
    expect(detectFatalLoss(order, "FRAUDULENT", 0).triggered).toBe(false);
  });

  it("handles non-numeric refund amount gracefully (no fire, no throw)", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "not-a-number", currencyCode: "USD" } },
    });
    expect(detectFatalLoss(order, "FRAUDULENT", 100).triggered).toBe(false);
  });
});

describe("detectFatalLoss — inr_no_fulfillment trigger", () => {
  it("fires for PRODUCT_NOT_RECEIVED + UNFULFILLED + 0 fulfillments", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [],
    });
    const r = detectFatalLoss(order, "PRODUCT_NOT_RECEIVED", 100);
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("inr_no_fulfillment");
    expect(r.message).toMatch(/fulfilled|shipping/i);
  });

  it("fires for legacy ITEM_NOT_RECEIVED reason code", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [],
    });
    expect(detectFatalLoss(order, "ITEM_NOT_RECEIVED", 100).triggered).toBe(true);
  });

  it("matches reason case-insensitively", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [],
    });
    expect(detectFatalLoss(order, "product_not_received", 100).triggered).toBe(true);
  });

  it("does NOT fire when order has been fulfilled", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "FULFILLED",
      fulfillments: [{ id: "gid://1" } as never],
    });
    expect(detectFatalLoss(order, "PRODUCT_NOT_RECEIVED", 100).triggered).toBe(false);
  });

  it("does NOT fire when status is UNFULFILLED but a fulfillment row exists (rare/inconsistent state)", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [{ id: "gid://1" } as never],
    });
    expect(detectFatalLoss(order, "PRODUCT_NOT_RECEIVED", 100).triggered).toBe(false);
  });

  it("does NOT fire on non-INR reasons even with no fulfillment", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [],
    });
    expect(detectFatalLoss(order, "FRAUDULENT", 100).triggered).toBe(false);
    expect(detectFatalLoss(order, "PRODUCT_UNACCEPTABLE", 100).triggered).toBe(false);
    expect(detectFatalLoss(order, "DUPLICATE", 100).triggered).toBe(false);
  });

  it("does NOT fire when reason is null", () => {
    const order = makeOrder({
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [],
    });
    expect(detectFatalLoss(order, null, 100).triggered).toBe(false);
  });
});

describe("detectFatalLoss — guards", () => {
  it("returns not-triggered when order is null", () => {
    expect(detectFatalLoss(null, "PRODUCT_NOT_RECEIVED", 100).triggered).toBe(false);
  });

  it("refund trigger takes precedence over INR check (both could match)", () => {
    // Hypothetical: INR + fully refunded. Refund evaluated first.
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
      displayFulfillmentStatus: "UNFULFILLED",
      fulfillments: [],
    });
    const r = detectFatalLoss(order, "PRODUCT_NOT_RECEIVED", 100);
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("refund_issued");
  });
});

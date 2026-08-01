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

// Regression — blume-box dispute 162042cd (2026-08-01). The merchant
// refunded $220 on 2026-07-13 and the chargeback arrived 2026-07-31.
// The gate ignored timing, capped the case at "weak / hard to win" and
// blocked auto-submit — telling the merchant that the single strongest
// representment available to them was structurally unwinnable.
describe("detectFatalLoss — refund timing", () => {
  const refundedOrder = (refundedAt: string | null) =>
    makeOrder({
      totalRefundedSet: { shopMoney: { amount: "220.00", currencyCode: "USD" } },
      refunds: refundedAt
        ? ([
            {
              id: "gid://shopify/Refund/1",
              createdAt: refundedAt,
              note: "Order canceled",
              totalRefundedSet: { shopMoney: { amount: "220.00", currencyCode: "USD" } },
            },
          ] as OrderDetailNode["refunds"])
        : [],
    });

  it("does NOT fire when the credit was issued BEFORE the dispute", () => {
    const r = detectFatalLoss(
      refundedOrder("2026-07-13T20:50:12Z"),
      "FRAUDULENT",
      220,
      "2026-07-31T21:00:26Z",
    );
    expect(r.triggered).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("fires when the refund came AFTER the dispute was opened", () => {
    const r = detectFatalLoss(
      refundedOrder("2026-08-02T10:00:00Z"),
      "FRAUDULENT",
      220,
      "2026-07-31T21:00:26Z",
    );
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("refund_issued");
  });

  it("stays conservative when the dispute date is unknown", () => {
    // The gate may only ever be over-strict. An unresolvable timestamp
    // must never become an auto-submission.
    expect(
      detectFatalLoss(refundedOrder("2026-07-13T20:50:12Z"), "FRAUDULENT", 220, null)
        .triggered,
    ).toBe(true);
  });

  it("stays conservative when no refund carries a usable timestamp", () => {
    expect(
      detectFatalLoss(refundedOrder(null), "FRAUDULENT", 220, "2026-07-31T21:00:26Z")
        .triggered,
    ).toBe(true);
    expect(
      detectFatalLoss(refundedOrder("not-a-date"), "FRAUDULENT", 220, "2026-07-31T21:00:26Z")
        .triggered,
    ).toBe(true);
  });

  it("a later top-up refund does not un-issue the pre-dispute credit", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "220.00", currencyCode: "USD" } },
      refunds: [
        {
          id: "gid://shopify/Refund/1",
          createdAt: "2026-07-13T20:50:12Z",
          note: null,
          totalRefundedSet: { shopMoney: { amount: "200.00", currencyCode: "USD" } },
        },
        {
          id: "gid://shopify/Refund/2",
          createdAt: "2026-08-02T10:00:00Z",
          note: null,
          totalRefundedSet: { shopMoney: { amount: "20.00", currencyCode: "USD" } },
        },
      ] as OrderDetailNode["refunds"],
    });
    expect(
      detectFatalLoss(order, "FRAUDULENT", 220, "2026-07-31T21:00:26Z").triggered,
    ).toBe(false);
  });
});

describe("detectFatalLoss — refund_issued trigger", () => {
  it("fires when totalRefunded covers disputed amount exactly", () => {
    const order = makeOrder({
      totalRefundedSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
    });
    const r = detectFatalLoss(order, "FRAUDULENT", 100);
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("refund_issued");
    expect(r.messageToken?.key).toBe("disputes.strengthReason.fatalLoss.refund_issued");
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
    expect(r.messageToken?.key).toBe("disputes.strengthReason.fatalLoss.inr_no_fulfillment");
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

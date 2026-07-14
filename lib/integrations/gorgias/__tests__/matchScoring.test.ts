/**
 * Match-scoring tests (PRD §11 weights, §10.4 date windows).
 *
 * Pure-function matrix: one case per signal, tier boundaries, negative-
 * signal dominance, and the "same customer, different order" case that must
 * never auto-qualify as disputed-order evidence.
 */

import { describe, expect, it } from "vitest";
import {
  scoreTicketMatch,
  tierForScore,
  orderNameDigits,
  MATCHING_ALGORITHM_VERSION,
  type OrderMatchSignals,
  type TicketForScoring,
} from "../matchScoring";

const baseOrder: OrderMatchSignals = {
  orderName: "#1066",
  customerEmail: "anna@example.com",
  shopifyCustomerId: "555001",
  trackingNumbers: ["JD014600003SE"],
  orderCreatedAt: "2026-03-01T10:00:00Z",
  deliveredAt: "2026-03-06T10:00:00Z",
  chargebackAt: "2026-06-20T10:00:00Z",
};

const baseTicket: TicketForScoring = {
  ticketId: 1,
  createdAt: "2026-03-10T10:00:00Z",
  customerEmail: null,
  customerShopifyId: null,
  subject: null,
  publicMessageText: "",
  linkedShopifyOrderName: null,
};

function signals(result: ReturnType<typeof scoreTicketMatch>): string[] {
  return result.reasons.map((r) => r.signal);
}

describe("matchScoring — individual signals", () => {
  it("exports a version for row/report provenance", () => {
    expect(MATCHING_ALGORITHM_VERSION).toBe(1);
  });

  it("+100 when the ticket is linked to the disputed Shopify order", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, linkedShopifyOrderName: "#1066" },
      { ...baseOrder },
    );
    expect(signals(r)).toContain("linked_shopify_order");
    expect(r.score).toBe(100);
    expect(r.confidence).toBe("high");
  });

  it("+80 when the disputed order number appears with a hash prefix", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, publicMessageText: "my order #1066 arrived broken" },
      baseOrder,
    );
    expect(signals(r)).toEqual(["order_number_in_text"]);
    expect(r.score).toBe(80);
  });

  it("+80 for a bare order number of >= 4 digits, word-bounded", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, subject: "Question about order 1066" },
      baseOrder,
    );
    expect(signals(r)).toContain("order_number_in_text");
  });

  it("no order-number hit when digits are embedded in a larger number", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, publicMessageText: "tracking id 91066523 is stuck" },
      baseOrder,
    );
    expect(signals(r)).not.toContain("order_number_in_text");
  });

  it("no bare-number hit for short (< 4 digit) order numbers", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, publicMessageText: "I bought 106 items" },
      { ...baseOrder, orderName: "#106" },
    );
    expect(signals(r)).not.toContain("order_number_in_text");
  });

  it("+70 for an exact Shopify customer id", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, customerShopifyId: "555001" },
      baseOrder,
    );
    expect(signals(r)).toEqual(["shopify_customer_id"]);
    expect(r.score).toBe(70);
  });

  it("+50 for an exact email match (case-insensitive)", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, customerEmail: "ANNA@Example.com " },
      baseOrder,
    );
    expect(signals(r)).toEqual(["email_match"]);
    expect(r.score).toBe(50);
  });

  it("-80 when the ticket email conflicts with the order email", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, customerEmail: "bob@other.com" },
      baseOrder,
    );
    expect(signals(r)).toEqual(["conflicting_email"]);
    expect(r.score).toBe(-80);
    expect(r.confidence).toBe("low");
  });

  it("+40 when a tracking number appears in the text", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, publicMessageText: "the site says jd014600003se is pending" },
      baseOrder,
    );
    expect(signals(r)).toEqual(["tracking_number_in_text"]);
    expect(r.score).toBe(40);
  });

  it("ignores too-short tracking tokens (noise guard)", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, publicMessageText: "code ab12 was used" },
      { ...baseOrder, trackingNumbers: ["ab12"] },
    );
    expect(signals(r)).toHaveLength(0);
  });

  it("-100 when the ticket references only a different order", () => {
    const r = scoreTicketMatch(
      {
        ...baseTicket,
        createdAt: null,
        customerEmail: "anna@example.com",
        publicMessageText: "please refund my order #2099",
      },
      baseOrder,
    );
    expect(signals(r)).toContain("references_other_order");
    // email +50, other order -100 → same customer / different order can
    // never auto-qualify as disputed-order evidence.
    expect(r.score).toBe(-50);
    expect(r.confidence).toBe("low");
  });

  it("no -100 when the disputed order is ALSO referenced", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null, publicMessageText: "orders #1066 and #2099" },
      baseOrder,
    );
    expect(signals(r)).toContain("order_number_in_text");
    expect(signals(r)).not.toContain("references_other_order");
  });
});

describe("matchScoring — date windows (PRD §10.4)", () => {
  it("+20 inside [order - 30d, delivered + 120d]", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: "2026-02-15T00:00:00Z" }, // 14d before order
      baseOrder,
    );
    expect(signals(r)).toEqual(["within_order_window"]);
    expect(r.score).toBe(20);
  });

  it("window end anchors on order date when delivery is unknown", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: "2026-06-25T00:00:00Z" }, // 116d after order
      { ...baseOrder, deliveredAt: null, chargebackAt: "2026-08-01T00:00:00Z" },
    );
    expect(signals(r)).toEqual(["within_order_window"]);
  });

  it("+10 after the window but before the chargeback", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: "2026-07-10T00:00:00Z" }, // > delivered+120d
      { ...baseOrder, chargebackAt: "2026-08-01T00:00:00Z" },
    );
    expect(signals(r)).toEqual(["before_chargeback"]);
    expect(r.score).toBe(10);
  });

  it("no bonus and no penalty after the chargeback", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: "2026-09-01T00:00:00Z" },
      { ...baseOrder, chargebackAt: "2026-08-01T00:00:00Z" },
    );
    expect(signals(r)).toHaveLength(0);
    expect(r.score).toBe(0);
  });

  it("no bonus before the 30-day pre-order window", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: "2026-01-15T00:00:00Z" },
      baseOrder,
    );
    expect(signals(r)).toHaveLength(0);
  });
});

describe("matchScoring — tiers and composition", () => {
  it("tier boundaries: 49/50 and 79/80", () => {
    expect(tierForScore(49)).toBe("low");
    expect(tierForScore(50)).toBe("medium");
    expect(tierForScore(79)).toBe("medium");
    expect(tierForScore(80)).toBe("high");
  });

  it("email + window = medium (70): shown but requires confirmation", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, customerEmail: "anna@example.com" },
      baseOrder,
    );
    expect(r.score).toBe(70);
    expect(r.confidence).toBe("medium");
  });

  it("email + order number + window = high (150)", () => {
    const r = scoreTicketMatch(
      {
        ...baseTicket,
        customerEmail: "anna@example.com",
        publicMessageText: "where is #1066?",
      },
      baseOrder,
    );
    expect(r.score).toBe(150);
    expect(r.confidence).toBe("high");
  });

  it("conflicting email beats strong positive signals", () => {
    const r = scoreTicketMatch(
      {
        ...baseTicket,
        customerEmail: "bob@other.com",
        customerShopifyId: "555001",
        createdAt: "2026-03-10T10:00:00Z",
      },
      baseOrder,
    );
    // +70 +20 -80 = 10 → low, never auto-matched
    expect(r.score).toBe(10);
    expect(r.confidence).toBe("low");
  });

  it("is safe on all-null inputs", () => {
    const r = scoreTicketMatch(
      { ...baseTicket, createdAt: null },
      {
        orderName: null,
        customerEmail: null,
        shopifyCustomerId: null,
        trackingNumbers: [],
        orderCreatedAt: null,
        deliveredAt: null,
        chargebackAt: null,
      },
    );
    expect(r.score).toBe(0);
    expect(r.confidence).toBe("low");
    expect(r.reasons).toEqual([]);
  });
});

describe("orderNameDigits", () => {
  it("extracts digits from #-prefixed and plain names", () => {
    expect(orderNameDigits("#1066")).toBe("1066");
    expect(orderNameDigits("Order 1066")).toBe("1066");
    expect(orderNameDigits("1066")).toBe("1066");
    expect(orderNameDigits("")).toBeNull();
    expect(orderNameDigits(null)).toBeNull();
    expect(orderNameDigits("no digits")).toBeNull();
  });
});

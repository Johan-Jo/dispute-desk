/**
 * Credit-already-issued detection.
 *
 * The single timing comparison the fatal-loss gate, the refund
 * collector and the strength floor all read. Everything unknown must
 * resolve to NOT triggered — a wrong `true` here becomes a claim to a
 * card issuer that we credited a transaction we did not.
 */

import { describe, expect, it } from "vitest";
import { detectCreditAlreadyIssued } from "../creditTiming";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

function order(
  refunds: Array<{ createdAt: string; amount?: string }>,
  totalRefunded = "220.00",
): OrderDetailNode {
  return {
    totalRefundedSet: { shopMoney: { amount: totalRefunded, currencyCode: "USD" } },
    refunds: refunds.map((r, i) => ({
      id: `gid://shopify/Refund/${i}`,
      createdAt: r.createdAt,
      note: null,
      totalRefundedSet: {
        shopMoney: { amount: r.amount ?? totalRefunded, currencyCode: "USD" },
      },
    })),
  } as OrderDetailNode;
}

const DISPUTED_AT = "2026-07-31T21:00:26Z";

describe("detectCreditAlreadyIssued", () => {
  it("fires on the blume-box shape: refunded 18 days before the dispute", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
      disputeAmount: 220,
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.refundedAt).toBe("2026-07-13T20:50:12Z");
    expect(r.amount).toBe(220);
    expect(r.coversDisputedAmount).toBe(true);
    expect(r.residual).toBeNull();
  });

  it("reports the residual when the dispute exceeds the credit", () => {
    // 162042cd's real shape: $220 credited, $235 disputed.
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
      disputeAmount: 235,
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.coversDisputedAmount).toBe(false);
    expect(r.residual).toBe(15);
  });

  it("does NOT fire when the refund came after the dispute", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-08-02T10:00:00Z" }]),
      disputeAmount: 220,
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(false);
  });

  it("reports the LATEST pre-dispute refund, ignoring later ones", () => {
    const r = detectCreditAlreadyIssued({
      order: order([
        { createdAt: "2026-07-01T00:00:00Z" },
        { createdAt: "2026-07-13T20:50:12Z" },
        { createdAt: "2026-08-02T10:00:00Z" },
      ]),
      disputeAmount: 220,
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.refundedAt).toBe("2026-07-13T20:50:12Z");
  });

  it("never guesses: unknown dispute date or refund timestamp is NOT triggered", () => {
    expect(
      detectCreditAlreadyIssued({
        order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
        disputeAmount: 220,
        disputeInitiatedAt: null,
      }).triggered,
    ).toBe(false);
    expect(
      detectCreditAlreadyIssued({
        order: order([{ createdAt: "not-a-date" }]),
        disputeAmount: 220,
        disputeInitiatedAt: DISPUTED_AT,
      }).triggered,
    ).toBe(false);
    expect(
      detectCreditAlreadyIssued({
        order: null,
        disputeAmount: 220,
        disputeInitiatedAt: DISPUTED_AT,
      }).triggered,
    ).toBe(false);
  });

  it("does not claim coverage when the disputed amount is unknown", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
      disputeAmount: null,
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.coversDisputedAmount).toBe(false);
  });

  it("rounds the residual to currency precision", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }], "10.10"),
      disputeAmount: 25.13,
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.residual).toBe(15.03);
  });
});

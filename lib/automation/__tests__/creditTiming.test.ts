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
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.refundedAt).toBe("2026-07-13T20:50:12Z");
    expect(r.amount).toBe(220);
    expect(r.coversDisputedAmount).toBe(true);
    expect(r.residual).toBeNull();
  });

  it("still reports the residual on a covered-but-not-exact credit", () => {
    // 162042cd's real shape: $220 credited, $235 disputed. Above the
    // 90% threshold, so it counts as covered — but the $15 gap is real
    // and stays available to the narrative.
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
      disputeAmount: 235,
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.coversDisputedAmount).toBe(true);
    expect(r.residual).toBe(15);
  });

  it("does NOT fire when the refund came after the dispute", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-08-02T10:00:00Z" }]),
      disputeAmount: 220,
      disputeCurrency: "USD",
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
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.refundedAt).toBe("2026-07-13T20:50:12Z");
  });

  it("never guesses: unknown dispute date or refund timestamp is NOT triggered", () => {
    expect(
      detectCreditAlreadyIssued({
        order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
        disputeAmount: 220,
        disputeCurrency: "USD",
        disputeInitiatedAt: null,
      }).triggered,
    ).toBe(false);
    expect(
      detectCreditAlreadyIssued({
        order: order([{ createdAt: "not-a-date" }]),
        disputeAmount: 220,
        disputeCurrency: "USD",
        disputeInitiatedAt: DISPUTED_AT,
      }).triggered,
    ).toBe(false);
    expect(
      detectCreditAlreadyIssued({
        order: null,
        disputeAmount: 220,
        disputeCurrency: "USD",
        disputeInitiatedAt: DISPUTED_AT,
      }).triggered,
    ).toBe(false);
  });

  it("does not claim coverage when the disputed amount is unknown", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }]),
      disputeAmount: null,
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.coversDisputedAmount).toBe(false);
  });

  it("rounds the residual to currency precision", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }], "10.10"),
      disputeAmount: 25.13,
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.residual).toBe(15.03);
  });
});

// 25 prod disputes across 2 shops are denominated differently from
// their order (CAD dispute / USD order, EUR / SEK, EUR / USD, NOK / SEK,
// VND / USD). Comparing the raw numbers is meaningless, and the failure
// is asymmetric: a weak-currency refund against a strong-currency
// dispute reads as MORE than it is, producing a false "credited in full"
// to an issuer.
describe("currency mismatch", () => {
  const refunded = order([{ createdAt: "2026-07-13T20:50:12Z" }], "200.00");

  it("never claims coverage across currencies, even when the number looks bigger", () => {
    const r = detectCreditAlreadyIssued({
      order: refunded, // 200 CAD refunded (shop currency USD in fixture)
      disputeAmount: 178,
      disputeCurrency: "CAD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    // 200 >= 178 numerically, but the units differ.
    expect(r.coversDisputedAmount).toBe(false);
    expect(r.residual).toBeNull();
    expect(r.coverageUnknownCurrencyMismatch).toBe(true);
    // The credit itself is still real and still worth arguing.
    expect(r.triggered).toBe(true);
    expect(r.refundedAt).toBe("2026-07-13T20:50:12Z");
  });

  it("compares normally when the currencies match", () => {
    const r = detectCreditAlreadyIssued({
      order: refunded,
      disputeAmount: 178,
      disputeCurrency: "usd", // case-insensitive
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.coversDisputedAmount).toBe(true);
    expect(r.coverageUnknownCurrencyMismatch).toBe(false);
  });
});

// Threshold calibrated on prod: the worst genuine same-currency overage
// leaves 90.7% coverage, so 0.90 admits every real fee overage and
// nothing else.
describe("COVERAGE_THRESHOLD", () => {
  it("treats 162042cd's $220-of-$235 (93.6%) as covered", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }], "220.00"),
      disputeAmount: 235,
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.coversDisputedAmount).toBe(true);
    expect(r.residual).toBe(15);
  });

  it("does NOT treat a token credit as covering the dispute", () => {
    // $5 goodwill refund on a $500 dispute — the case this threshold
    // exists to keep out of the strength floor.
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }], "5.00"),
      disputeAmount: 500,
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.triggered).toBe(true);
    expect(r.coversDisputedAmount).toBe(false);
    expect(r.residual).toBe(495);
  });

  it("holds the line just below the threshold", () => {
    const r = detectCreditAlreadyIssued({
      order: order([{ createdAt: "2026-07-13T20:50:12Z" }], "89.00"),
      disputeAmount: 100,
      disputeCurrency: "USD",
      disputeInitiatedAt: DISPUTED_AT,
    });
    expect(r.coversDisputedAmount).toBe(false);
  });
});

/**
 * Returned-to-sender gate — trigger conditions, ordering, and the block.
 *
 * The case this exists for is cay-collective #13195: parcel returned to
 * the merchant 2026-07-06, kr400 kept, dispute filed 2026-08-18, and
 * DisputeDesk scored it MODERATE with a draft that would have been filed
 * at the deadline.
 */

import { describe, it, expect } from "vitest";
import { detectReturnedToSender } from "../returnedToSender";
import { evaluateAutoSubmitGuards } from "../autoSubmitGuards";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

function order(refunded: string): OrderDetailNode {
  return {
    totalRefundedSet: { shopMoney: { amount: refunded, currencyCode: "SEK" } },
  } as unknown as OrderDetailNode;
}

const RETURNED_AT = "2026-07-06T09:40:00";

describe("detectReturnedToSender", () => {
  it("triggers on a returned, unrefunded order", () => {
    const r = detectReturnedToSender({
      returnedToSender: true,
      returnedAt: RETURNED_AT,
      order: order("0.0"),
      disputeAmount: 400,
    });
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("returned_unrefunded");
    expect(r.returnedAt).toBe(RETURNED_AT);
    expect(r.messageToken?.key).toBe(
      "disputes.strengthReason.returnedToSender.returned_unrefunded",
    );
  });

  it("stays quiet when no parcel came back", () => {
    expect(
      detectReturnedToSender({
        returnedToSender: false,
        returnedAt: null,
        order: order("0.0"),
        disputeAmount: 400,
      }).triggered,
    ).toBe(false);
  });

  it("stays quiet when the money followed the goods", () => {
    // Returned AND refunded is a resolved order, not a gap. The refund
    // gates reason about it on their own terms.
    expect(
      detectReturnedToSender({
        returnedToSender: true,
        returnedAt: RETURNED_AT,
        order: order("400.0"),
        disputeAmount: 400,
      }).triggered,
    ).toBe(false);
  });

  it("still triggers on a PARTIAL refund — the gap is what matters", () => {
    expect(
      detectReturnedToSender({
        returnedToSender: true,
        returnedAt: RETURNED_AT,
        order: order("100.0"),
        disputeAmount: 400,
      }).triggered,
    ).toBe(true);
  });

  it("triggers when the disputed amount is unknown", () => {
    // Fail toward the stricter outcome: an unknown amount cannot prove
    // the customer was made whole, and this gate only ever makes
    // automation stricter.
    expect(
      detectReturnedToSender({
        returnedToSender: true,
        returnedAt: null,
        order: order("400.0"),
        disputeAmount: null,
      }).triggered,
    ).toBe(true);
  });

  it("survives a missing order", () => {
    expect(
      detectReturnedToSender({
        returnedToSender: true,
        returnedAt: RETURNED_AT,
        order: null,
        disputeAmount: 400,
      }).triggered,
    ).toBe(true);
  });
});

describe("auto-submit is blocked for a returned parcel", () => {
  const triggered = { triggered: true, reason: "returned_unrefunded" };

  it("blocks even when the strength band would otherwise proceed", () => {
    const v = evaluateAutoSubmitGuards({
      coverageState: null,
      fatalLoss: null,
      returnedToSender: triggered,
      caseStrength: "strong",
      creditAlreadyIssued: null,
    });
    expect(v.decision).toBe("block");
    expect(v.decision === "block" && v.reason).toBe("returned_to_sender");
  });

  it("does not pre-empt coverage — Shopify Protect still wins", () => {
    const v = evaluateAutoSubmitGuards({
      coverageState: "covered_shopify",
      fatalLoss: null,
      returnedToSender: triggered,
      caseStrength: "strong",
      creditAlreadyIssued: null,
    });
    expect(v.decision === "block" && v.reason).toBe("covered_shopify");
  });

  it("does not pre-empt fatal-loss — an issued refund is the bigger fact", () => {
    const v = evaluateAutoSubmitGuards({
      coverageState: null,
      fatalLoss: { triggered: true, reason: "refund_issued" },
      returnedToSender: triggered,
      caseStrength: "strong",
      creditAlreadyIssued: null,
    });
    expect(v.decision === "block" && v.reason).toBe("fatal_loss");
  });

  it("beats the credit-already-issued fast path", () => {
    // The credit floor's premise is that the cardholder already has the
    // money. This gate only fires when they do not.
    const v = evaluateAutoSubmitGuards({
      coverageState: null,
      fatalLoss: null,
      returnedToSender: triggered,
      caseStrength: "strong",
      creditAlreadyIssued: { triggered: true, coversDisputedAmount: true },
    });
    expect(v.decision === "block" && v.reason).toBe("returned_to_sender");
  });

  it("changes nothing when the gate is absent (pre-2026-08-20 packs)", () => {
    const v = evaluateAutoSubmitGuards({
      coverageState: null,
      fatalLoss: null,
      returnedToSender: null,
      caseStrength: "strong",
      creditAlreadyIssued: null,
    });
    expect(v.decision).toBe("proceed");
  });
});

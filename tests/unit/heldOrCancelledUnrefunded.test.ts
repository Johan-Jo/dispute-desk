/**
 * The predicate behind the "nothing shipped, money still captured" banner.
 *
 * Measured on production 2026-08-14 across open, unsubmitted disputes:
 * 11 cancelled and 6 ON_HOLD, every one PAID with 0.0 refunded. The merchant
 * saw only `delivery_proof: unavailable` and strength `weak` — which reads as
 * "we failed to ship" rather than "your fraud screening caught this and the
 * payment is still captured".
 *
 * The failure mode this file guards is the opposite one: telling a merchant
 * "no refund has been issued" when we do not actually know.
 */

import { describe, it, expect } from "vitest";
import { heldOrCancelledUnrefunded } from "@/lib/disputes/heldOrCancelledUnrefunded";

describe("the two states it names", () => {
  it("held: ON_HOLD, PAID, nothing refunded — the six-dispute case", () => {
    expect(
      heldOrCancelledUnrefunded({
        fulfillmentStatus: "ON_HOLD",
        financialStatus: "PAID",
        refundedAmount: "0.0",
        cancelledAt: null,
      }),
    ).toBe("held");
  });

  it("cancelled: PAID, nothing refunded — the eleven-dispute case", () => {
    expect(
      heldOrCancelledUnrefunded({
        fulfillmentStatus: "UNFULFILLED",
        financialStatus: "PAID",
        refundedAmount: "0.0",
        cancelledAt: "2026-07-13T20:49:00Z",
      }),
    ).toBe("cancelled");
  });

  it("cancelled wins when an order is somehow both", () => {
    /* Cancelled is the stronger statement — a deliberate, completed decision
     * — so it is the one worth telling the merchant about. */
    expect(
      heldOrCancelledUnrefunded({
        fulfillmentStatus: "ON_HOLD",
        financialStatus: "PAID",
        refundedAmount: "0.0",
        cancelledAt: "2026-07-13T20:49:00Z",
      }),
    ).toBe("cancelled");
  });
});

describe("a refunded order is not in this state", () => {
  it("#352800 — cancelled AND fully refunded, the one that was handled correctly", () => {
    expect(
      heldOrCancelledUnrefunded({
        fulfillmentStatus: "UNFULFILLED",
        financialStatus: "REFUNDED",
        refundedAmount: "220.0",
        cancelledAt: "2026-07-13T20:50:00Z",
      }),
    ).toBeNull();
  });

  it("a partial refund on a still-PAID order does not fire", () => {
    expect(
      heldOrCancelledUnrefunded({
        fulfillmentStatus: "ON_HOLD",
        financialStatus: "PAID",
        refundedAmount: "50.0",
        cancelledAt: null,
      }),
    ).toBeNull();
  });
});

describe("it fails CLOSED on anything unknown", () => {
  /* The banner asserts "no refund has been issued". Asserting that from
   * absent data tells a merchant something untrue about their own money —
   * a worse outcome than showing no banner at all. */
  for (const [label, refundedAmount] of [
    ["absent", undefined],
    ["null", null],
    ["empty string", ""],
    ["unparseable", "not-a-number"],
  ] as Array<[string, string | null | undefined]>) {
    it(`stays silent when the refunded amount is ${label}`, () => {
      expect(
        heldOrCancelledUnrefunded({
          fulfillmentStatus: "ON_HOLD",
          financialStatus: "PAID",
          refundedAmount,
          cancelledAt: null,
        }),
      ).toBeNull();
    });
  }

  it("stays silent on a null order", () => {
    expect(heldOrCancelledUnrefunded(null)).toBeNull();
    expect(heldOrCancelledUnrefunded(undefined)).toBeNull();
  });
});

describe("only a CAPTURED payment can be sitting unreturned", () => {
  for (const financialStatus of ["AUTHORIZED", "PENDING", "VOIDED", "REFUNDED", null]) {
    it(`does not fire on financialStatus=${financialStatus ?? "null"}`, () => {
      expect(
        heldOrCancelledUnrefunded({
          fulfillmentStatus: "ON_HOLD",
          financialStatus,
          refundedAmount: "0.0",
          cancelledAt: null,
        }),
      ).toBeNull();
    });
  }
});

describe("ordinary orders are untouched", () => {
  for (const fulfillmentStatus of ["FULFILLED", "UNFULFILLED", "PARTIAL", null]) {
    it(`does not fire on a non-cancelled ${fulfillmentStatus ?? "null"} order`, () => {
      expect(
        heldOrCancelledUnrefunded({
          fulfillmentStatus,
          financialStatus: "PAID",
          refundedAmount: "0.0",
          cancelledAt: null,
        }),
      ).toBeNull();
    });
  }
});

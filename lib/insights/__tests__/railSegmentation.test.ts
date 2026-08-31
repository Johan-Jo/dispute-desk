/**
 * Tests for payment-rail segmentation.
 *
 * The shapes below are the three real prod shops measured on 2026-08-30,
 * because the whole point of this module is that rail mix is NOT uniform and
 * a single assumption breaks on one of them:
 *
 *   Mein Maison   92.3% PayPal disputes  →  card framing must NOT apply
 *   blume-box     0% PayPal, card+wallet →  card framing MUST apply
 *   surasvenne    mixed, 74.5% unknown   →  everything is soft
 */

import { describe, it, expect } from "vitest";
import {
  segmentByRail,
  classifyRail,
  RAIL_MIN_ORDERS_FOR_RATE,
} from "../railSegmentation";

/** Card share of DISPUTES, prod 2026-08-30 — the reason this module exists.
 *  It separates the shops cleanly where card share of ORDERS does not:
 *  Mein Maison is 20.1% card by orders but only 7.7% by disputes.
 *
 *  These are shares of CLASSIFIED disputes (unknown excluded from the base),
 *  matching `cardDisputeShare`. Measuring over all disputes instead gives
 *  slightly different figures — blume-box 99.2% rather than 99.6% — which is
 *  the same unknown-in-the-denominator mistake this module exists to stop. */
const PROD_CARD_DISPUTE_SHARE = {
  blumeBox: 470 / 472,
  meinMaison: 40 / 520,
};

function orders(spec: Record<string, number>) {
  const rows: Array<{ payment_method: string | null }> = [];
  for (const [method, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) {
      rows.push({ payment_method: method === "null" ? null : method });
    }
  }
  return rows;
}

describe("classifyRail", () => {
  it("puts PayPal on the alt rail — it settles through Shopify Payments but has no card network", () => {
    expect(classifyRail("paypal")).toBe("alt");
  });

  it("puts card wallets on the card rail — they do reach a card network", () => {
    expect(classifyRail("card")).toBe("card");
    expect(classifyRail("apple_pay")).toBe("card");
    expect(classifyRail("google_pay")).toBe("card");
    // Both spellings: Shopify emits SHOPIFY_PAY, the product is "Shop Pay".
    expect(classifyRail("shop_pay")).toBe("card");
    expect(classifyRail("shopify_pay")).toBe("card");
  });

  it("puts BNPL and local methods on the alt rail", () => {
    expect(classifyRail("klarna")).toBe("alt");
    expect(classifyRail("shop_pay_installments")).toBe("alt");
  });

  it("treats an unresolved method as unknown, never as card", () => {
    // This is the load-bearing case. The PaymentDetails union bug persisted
    // PayPal orders with a NULL payment_method; classifying NULL as card
    // would reproduce the original 8x misread exactly.
    expect(classifyRail(null)).toBe("unknown");
    expect(classifyRail("")).toBe("unknown");
    expect(classifyRail("   ")).toBe("unknown");
  });

  it("puts an unrecognised real method on alt rather than card", () => {
    // tiktok_shop / shop_cash / gift_card are real methods seen on prod.
    // They are not card networks, so they must not inflate a card denominator.
    expect(classifyRail("tiktok_shop")).toBe("alt");
    expect(classifyRail("shop_cash")).toBe("alt");
    expect(classifyRail("gift_card")).toBe("alt");
  });

  it("is case-insensitive", () => {
    expect(classifyRail("PayPal")).toBe("alt");
    expect(classifyRail("CARD")).toBe("card");
  });
});

describe("segmentByRail — the three buckets stay separate", () => {
  it("never folds unknown into card or alt", () => {
    const seg = segmentByRail(
      orders({ card: 100, paypal: 100, null: 100 }),
      orders({ card: 5, paypal: 50, null: 20 }),
    );
    expect(seg.card.orders).toBe(100);
    expect(seg.alt.orders).toBe(100);
    expect(seg.unknown.orders).toBe(100);
    expect(seg.unknown.disputes).toBe(20);
    // cardShare is over CLASSIFIED orders only — unknown is not a rail, so
    // including it in the base would understate card's real share.
    expect(seg.cardShare).toBeCloseTo(0.5);
    expect(seg.unknownShare).toBeCloseTo(1 / 3);
  });

  it("never produces a rate for the unknown bucket", () => {
    const seg = segmentByRail(orders({ null: 5000 }), orders({ null: 100 }));
    expect(seg.unknown.ratePct).toBeNull();
  });
});

describe("segmentByRail — real shop shapes", () => {
  it("Mein Maison: PayPal-dominant, so card framing must not apply", () => {
    // ~77% PayPal orders; 92.3% of disputes on the alt rail.
    const seg = segmentByRail(
      orders({ paypal: 14943, card: 2916, apple_pay: 842, null: 54 }),
      // Exact prod breakdown: 482 paypal, 38 card, 1 apple_pay, 1 shopify_pay.
      // The two wallet disputes belong on the CARD rail — omitting them is
      // how a card denominator quietly loses its numerator.
      orders({ paypal: 482, card: 38, apple_pay: 1, shopify_pay: 1 }),
    );
    expect(seg.alt.ratePct).toBeCloseTo((482 / 14943) * 100, 2);
    expect(seg.card.ratePct).toBeCloseTo((40 / 3758) * 100, 2);
    // The card rate is an order of magnitude below the blended one, which is
    // the entire finding: 8x overstated when the rails are mixed.
    expect(seg.card.ratePct!).toBeLessThan(seg.alt.ratePct!);
    // The trap this pins: by ORDER volume this shop is 20.1% card, which
    // clears any "is there meaningful card traffic" bar. By DISPUTES it is
    // 7.7% card. Card framing must key on the latter, or a merchant whose
    // disputes are 92.3% PayPal gets Visa/Mastercard verdicts.
    expect(seg.cardShare!).toBeCloseTo(0.201, 2);
    expect(seg.cardDisputeShare!).toBeCloseTo(PROD_CARD_DISPUTE_SHARE.meinMaison, 3);
    expect(seg.cardFramingApplies).toBe(false);
  });

  it("blume-box: card + wallets dominant, so card framing does apply", () => {
    const seg = segmentByRail(
      orders({
        shopify_pay: 7220,
        apple_pay: 2829,
        card: 1332,
        paypal: 818,
        shop_pay_installments: 712,
        tiktok_shop: 353,
        null: 4005,
      }),
      orders({ card: 374, shopify_pay: 65, apple_pay: 31, null: 2 }),
    );
    expect(seg.cardFramingApplies).toBe(true);
    expect(seg.cardShare!).toBeGreaterThan(0.85);
    // Fixture has no alt-rail disputes at all, so the share is exactly 1;
    // prod is 470/472 once the 2 unknowns leave the base.
    expect(seg.cardDisputeShare).toBe(1);
    expect(PROD_CARD_DISPUTE_SHARE.blumeBox).toBeGreaterThan(0.99);
    // Its disputes are essentially all card-rail, matching prod.
    expect(seg.card.disputes).toBe(470);
    expect(seg.alt.disputes).toBe(0);
  });

  it("surasvenne: unknown dominates, so card framing is withheld", () => {
    const seg = segmentByRail(
      orders({ null: 4708, paypal: 1158, klarna: 434, card: 21 }),
      orders({ paypal: 6, card: 21, null: 17 }),
    );
    expect(seg.unknownShare).toBeGreaterThan(0.7);
    // Its dispute book IS half card — but card order volume is too thin to
    // put a number next to a threshold, so framing is still withheld. Both
    // conditions have to hold.
    // Its dispute book is card-majority (21 of 27 classified), which alone
    // would clear the framing bar — but card ORDER volume is far too thin to
    // print a rate next to a threshold. Both conditions must hold.
    expect(seg.cardDisputeShare!).toBeGreaterThan(0.5);
    // Card orders are below the floor, so no card rate and no card framing.
    expect(seg.card.ratePct).toBeNull();
    expect(seg.cardFramingApplies).toBe(false);
  });
});

describe("segmentByRail — thin denominators", () => {
  it("returns null, not 0%, when a rail is below the volume floor", () => {
    // The bug this guards: safeRatio returning 0 for an empty denominator
    // renders a confident green "0.00%" VAMP pill for a merchant with no
    // card volume at all. "No card orders" and "no card disputes" are
    // different statements.
    const seg = segmentByRail(
      orders({ card: RAIL_MIN_ORDERS_FOR_RATE - 1, paypal: 500 }),
      orders({ paypal: 10 }),
    );
    expect(seg.card.orders).toBe(RAIL_MIN_ORDERS_FOR_RATE - 1);
    expect(seg.card.ratePct).toBeNull();
    expect(seg.cardFramingApplies).toBe(false);
  });

  it("emits a rate once the floor is met", () => {
    const seg = segmentByRail(
      orders({ card: RAIL_MIN_ORDERS_FOR_RATE }),
      orders({ card: 1 }),
    );
    expect(seg.card.ratePct).toBeCloseTo(2, 5);
  });

  it("handles an empty window without dividing by zero", () => {
    const seg = segmentByRail([], []);
    expect(seg.card.ratePct).toBeNull();
    expect(seg.alt.ratePct).toBeNull();
    expect(seg.cardShare).toBeNull();
    expect(seg.cardFramingApplies).toBe(false);
    expect(seg.unknownShare).toBe(0);
  });

  it("does not claim card framing when every order is unclassified", () => {
    const seg = segmentByRail(orders({ null: 1000 }), orders({ null: 40 }));
    expect(seg.cardShare).toBeNull();
    expect(seg.cardFramingApplies).toBe(false);
    expect(seg.unknownShare).toBe(1);
  });
});

describe("classifyRail — the CARD_RAIL_METHODS contract", () => {
  // lib/liabilityShift/ratios/calculate.ts filters its Visa/Mastercard
  // settlement denominator with a literal CARD_RAIL_METHODS array, because a
  // PostgREST `.in()` cannot call this function. The two must agree: if a
  // method is card here but missing there, the VAMP denominator silently
  // loses orders and the ratio inflates.
  const CARD_RAIL_METHODS = [
    "card",
    "apple_pay",
    "google_pay",
    "shop_pay",
    "shopify_pay",
  ];

  it("classifies every CARD_RAIL_METHODS entry as card", () => {
    for (const m of CARD_RAIL_METHODS) {
      expect(classifyRail(m)).toBe("card");
    }
  });

  it("classifies nothing outside that list as card", () => {
    for (const m of [
      "paypal",
      "klarna",
      "shop_pay_installments",
      "tiktok_shop",
      "shop_cash",
      "gift_card",
      null,
    ]) {
      expect(classifyRail(m)).not.toBe("card");
    }
  });
});

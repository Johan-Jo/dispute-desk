/**
 * PayPal wallet overlay.
 *
 * `paymentOverlays.test.ts` had no PayPal case at all, which is how the
 * generic BNPL overlay — opening "paid via a Buy-Now-Pay-Later or local
 * payment method (e.g. Klarna, Affirm)" — came to be the framing on a
 * merchant whose 518-of-522 disputes are PayPal wallet payments. These pin
 * the rail framing and the per-reason foregrounding.
 */

import { describe, it, expect } from "vitest";

import { paymentOverlayFor } from "@/lib/defence/paymentOverlays";
import {
  buildPaypalOverlay,
  paypalCategoryForReason,
} from "@/lib/defence/paypalOverlay";

describe("paymentOverlayFor — PayPal routes to the wallet overlay", () => {
  it("does not describe a PayPal payment as Buy-Now-Pay-Later", () => {
    const { overlay } = paymentOverlayFor("paypal");
    expect(overlay).toBeTruthy();
    expect(overlay).toContain("PayPal wallet");
    expect(overlay).not.toContain("Buy-Now-Pay-Later or local payment method");
  });

  it("keeps the card-phrase ban that applies to every non-card rail", () => {
    const { prohibitedPhrases } = paymentOverlayFor("paypal");
    expect(prohibitedPhrases.length).toBeGreaterThan(0);
    expect(prohibitedPhrases.some((r) => r.test("3-D Secure"))).toBe(true);
    expect(prohibitedPhrases.some((r) => r.test("AVS"))).toBe(true);
  });

  it("works without a context object, still correctly framed", () => {
    const { overlay } = paymentOverlayFor("paypal", undefined);
    expect(overlay).toContain("PayPal wallet");
  });

  it("leaves card unchanged — no overlay", () => {
    expect(paymentOverlayFor("card").overlay).toBeNull();
  });

  it("leaves Klarna on the Klarna overlay", () => {
    const { overlay } = paymentOverlayFor("klarna", {
      shopifyReason: "PRODUCT_NOT_RECEIVED",
    });
    expect(overlay).not.toContain("PayPal wallet");
  });
});

describe("paypalCategoryForReason", () => {
  it("maps the two reasons that carry this merchant's book", () => {
    expect(paypalCategoryForReason("PRODUCT_NOT_RECEIVED")).toBe("item_not_received");
    expect(paypalCategoryForReason("PRODUCT_UNACCEPTABLE")).toBe("not_as_described");
  });

  it("treats FRAUDULENT as an unauthorized claim", () => {
    expect(paypalCategoryForReason("FRAUDULENT")).toBe("unauthorized");
  });

  it("falls back to generic for an unknown or absent reason", () => {
    expect(paypalCategoryForReason(null)).toBe("generic");
    expect(paypalCategoryForReason("SOMETHING_ELSE")).toBe("generic");
  });
});

describe("buildPaypalOverlay — the reason decides what leads", () => {
  it("tells the writer delivery is not conformity on a not-as-described claim", () => {
    const overlay = buildPaypalOverlay({ shopifyReason: "PRODUCT_UNACCEPTABLE" });
    expect(overlay).toContain("DELIVERY IS NOT CONFORMITY");
    expect(overlay).toContain("listing as it appeared at the time of purchase");
  });

  it("leads with delivery on an item-not-received claim", () => {
    const overlay = buildPaypalOverlay({ shopifyReason: "PRODUCT_NOT_RECEIVED" });
    expect(overlay).toContain("delivery\nscan");
    expect(overlay).not.toContain("DELIVERY IS NOT CONFORMITY");
  });

  it("refuses to let a successful payment stand as authorization proof", () => {
    const overlay = buildPaypalOverlay({ shopifyReason: "FRAUDULENT" });
    expect(overlay).toContain("Do not offer a\nsuccessful payment or an order record as proof of authorization");
  });

  it("never claims Seller Protection applies", () => {
    for (const reason of [
      "PRODUCT_NOT_RECEIVED",
      "PRODUCT_UNACCEPTABLE",
      "FRAUDULENT",
      null,
    ]) {
      const overlay = buildPaypalOverlay({ shopifyReason: reason });
      expect(overlay).toContain("unless an approved fact establishes it");
    }
  });

  it("bans card vocabulary in words, for every reason", () => {
    for (const reason of ["PRODUCT_NOT_RECEIVED", "DUPLICATE", null]) {
      const overlay = buildPaypalOverlay({ shopifyReason: reason });
      expect(overlay).toContain("STRICTLY FORBIDDEN");
      expect(overlay).toContain("no card network, no card issuer");
    }
  });
});

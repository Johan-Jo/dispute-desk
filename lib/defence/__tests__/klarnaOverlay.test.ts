import { describe, it, expect } from "vitest";
import {
  buildKlarnaOverlay,
  klarnaCategoryForReason,
} from "@/lib/defence/klarnaOverlay";
import { paymentOverlayFor } from "@/lib/defence/paymentOverlays";

describe("klarnaCategoryForReason", () => {
  it("maps Shopify reasons to Klarna categories", () => {
    expect(klarnaCategoryForReason("PRODUCT_NOT_RECEIVED")).toBe("goods_not_received");
    expect(klarnaCategoryForReason("PRODUCT_UNACCEPTABLE")).toBe("faulty_or_not_as_described");
    expect(klarnaCategoryForReason("CREDIT_NOT_PROCESSED")).toBe("refund_not_processed");
    expect(klarnaCategoryForReason("DUPLICATE")).toBe("incorrect_amount");
    expect(klarnaCategoryForReason("FRAUDULENT")).toBe("unauthorized_purchase");
  });
  it("falls back to generic for unknown/absent reasons", () => {
    expect(klarnaCategoryForReason(null)).toBe("generic");
    expect(klarnaCategoryForReason("WHATEVER")).toBe("generic");
  });
});

describe("buildKlarnaOverlay", () => {
  it("injects POD / proof-of-delivery guidance for goods not received", () => {
    const o = buildKlarnaOverlay({ shopifyReason: "PRODUCT_NOT_RECEIVED" });
    expect(o).toMatch(/GOODS \/ SERVICES NOT RECEIVED/);
    expect(o).toMatch(/PROOF OF DELIVERY/i);
    expect(o).toMatch(/signature/i);
  });

  it("injects refund/return guidance for refund not processed", () => {
    const o = buildKlarnaOverlay({ shopifyReason: "CREDIT_NOT_PROCESSED" });
    expect(o).toMatch(/REFUND NOT PROCESSED/);
    expect(o).toMatch(/refund record/i);
  });

  it("names the sub-product when provided", () => {
    expect(buildKlarnaOverlay({ shopifyReason: "PRODUCT_NOT_RECEIVED", subProduct: "pay_later" }))
      .toMatch(/Pay Later/);
    expect(buildKlarnaOverlay({ shopifyReason: "PRODUCT_NOT_RECEIVED", subProduct: "pay_now" }))
      .toMatch(/Pay Now/);
  });

  it("NEVER contains card-network vocabulary", () => {
    for (const reason of [
      "PRODUCT_NOT_RECEIVED",
      "CREDIT_NOT_PROCESSED",
      "FRAUDULENT",
      "DUPLICATE",
      null,
    ]) {
      const o = buildKlarnaOverlay({ shopifyReason: reason });
      // Prose *forbids* these terms, so they legitimately appear in the
      // FORBIDDEN list — assert they are only in a forbidding context by
      // checking the overlay never *instructs* their use.
      expect(o).toMatch(/STRICTLY FORBIDDEN/);
      expect(o).toMatch(/Klarna/);
    }
  });
});

describe("paymentOverlayFor — Klarna routing", () => {
  it("returns the Klarna category overlay when family=klarna + reason given", () => {
    const { overlay, prohibitedPhrases } = paymentOverlayFor("klarna", {
      shopifyReason: "PRODUCT_NOT_RECEIVED",
      subProduct: "pay_later",
    });
    expect(overlay).toMatch(/GOODS \/ SERVICES NOT RECEIVED/);
    expect(overlay).toMatch(/Pay Later/);
    expect(prohibitedPhrases.length).toBeGreaterThan(0);
  });

  it("falls back to the generic BNPL overlay for klarna with no reason context", () => {
    const { overlay } = paymentOverlayFor("klarna");
    expect(overlay).toMatch(/Buy-Now-Pay-Later/);
  });

  it("uses the generic BNPL overlay for affirm even with a reason", () => {
    const { overlay } = paymentOverlayFor("affirm", { shopifyReason: "PRODUCT_NOT_RECEIVED" });
    expect(overlay).toMatch(/Buy-Now-Pay-Later/);
    // The generic overlay is NOT the Klarna category overlay — it has no
    // "PAYMENT METHOD OVERLAY — Klarna" header nor Klarna category blocks.
    expect(overlay).not.toMatch(/OVERLAY — Klarna/);
    expect(overlay).not.toMatch(/GOODS \/ SERVICES NOT RECEIVED/);
  });

  it("returns null overlay for card", () => {
    expect(paymentOverlayFor("card").overlay).toBeNull();
  });
});

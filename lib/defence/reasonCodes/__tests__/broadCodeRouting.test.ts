/**
 * Mastercard 4853 is a bucket code ("cardholder dispute"), not a claim type.
 * Prod had 6 letters where it forced the not-as-described module onto fraud,
 * duplicate and item-not-received disputes. A card letter must also never
 * print a network code the dispute did not carry.
 */
import { describe, it, expect } from "vitest";
import { resolveCaseReasonCodeModule, resolveReasonCodeModule } from "../registry";
import { cardReasonCodeDisplay } from "../../klarnaDisputeCategory";

const route = (nc: string | null, reason: string) =>
  resolveCaseReasonCodeModule({ networkReasonCode: nc, shopifyReason: reason, caseReason: reason }).key;

describe("broad network code 4853", () => {
  it.each([
    ["PRODUCT_NOT_RECEIVED", "inr_product_not_received"],
    ["FRAUDULENT", "visa_10_4_fraud"],
    ["DUPLICATE", "duplicate_processing"],
    ["CREDIT_NOT_PROCESSED", "credit_not_processed"],
    ["PRODUCT_UNACCEPTABLE", "product_unacceptable"],
  ])("defers to the specific Shopify reason %s", (reason, expected) => {
    expect(route("4853", reason)).toBe(expected);
  });

  it("keeps the network code when Shopify gives no specific reason", () => {
    expect(route("4853", "GENERAL")).toBe("product_unacceptable");
  });

  it("a specific code still wins over the Shopify reason", () => {
    expect(route("13.1", "PRODUCT_UNACCEPTABLE")).toBe("inr_product_not_received");
    expect(route("10.4", "PRODUCT_NOT_RECEIVED")).toBe("visa_10_4_fraud");
  });
});

describe("cardReasonCodeDisplay", () => {
  const inr = resolveReasonCodeModule("13.1");
  it("prints the module's network label only when the dispute carries one of its codes", () => {
    expect(cardReasonCodeDisplay({ module: inr, networkReasonCode: "13.1", shopifyReason: "PRODUCT_NOT_RECEIVED" })).toBe(inr.displayName);
  });
  it("prints a neutral label when the module was reached via the Shopify reason", () => {
    expect(cardReasonCodeDisplay({ module: inr, networkReasonCode: null, shopifyReason: "PRODUCT_NOT_RECEIVED" })).toBe("Card dispute — Item not received");
    expect(cardReasonCodeDisplay({ module: inr, networkReasonCode: "4853", shopifyReason: "PRODUCT_NOT_RECEIVED" })).toBe("Card dispute — Item not received");
  });
  it("leaves the generic fallback label alone", () => {
    const g = resolveReasonCodeModule(null);
    expect(cardReasonCodeDisplay({ module: g, networkReasonCode: null, shopifyReason: "GENERAL" })).toBe(g.displayName);
  });
});

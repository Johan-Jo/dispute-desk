/**
 * Tests for derivePaymentContext — the payment-method-family classifier.
 *
 * Covers the card path (must stay unchanged: card + network + wallet),
 * the BNPL/local path (Klarna variants, Affirm by prefix, unknown local),
 * and the null/empty fallbacks. The card cases pin that adding BNPL
 * support did NOT change card classification.
 */

import { describe, it, expect } from "vitest";
import { derivePaymentContext, isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import type { OrderDetailNode, OrderTransaction } from "@/lib/shopify/queries/orders";

/** Minimal order with a single primary sale transaction carrying the
 *  given paymentDetails. Cast through unknown — we only exercise the
 *  transaction/paymentDetails fields the classifier reads. */
function orderWith(
  paymentDetails: OrderTransaction["paymentDetails"],
  gateway = "shopify_payments",
): OrderDetailNode {
  const tx = {
    id: "gid://shopify/OrderTransaction/1",
    kind: "sale",
    status: "success",
    gateway,
    receiptJson: null,
    paymentDetails,
  } as OrderTransaction;
  return { transactions: [tx] } as unknown as OrderDetailNode;
}

describe("derivePaymentContext — card path (unchanged)", () => {
  it("Visa card → family card, network visa, no wallet", () => {
    const ctx = derivePaymentContext(
      orderWith({ __typename: "CardPaymentDetails", company: "Visa" } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("card");
    expect(ctx.cardNetwork).toBe("visa");
    expect(ctx.label).toBe("Card (visa)");
    expect(isNonCardPaymentFamily(ctx.family)).toBe(false);
  });

  it("Mastercard card → network mastercard", () => {
    const ctx = derivePaymentContext(
      orderWith({ __typename: "CardPaymentDetails", company: "Mastercard" } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("card");
    expect(ctx.cardNetwork).toBe("mastercard");
  });

  it("Amex card → network amex", () => {
    const ctx = derivePaymentContext(
      orderWith({ __typename: "CardPaymentDetails", company: "American Express" } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.cardNetwork).toBe("amex");
  });

  it("card + Apple Pay wallet → family card, wallet labeled, network preserved", () => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "CardPaymentDetails",
        company: "Visa",
        wallet: "APPLE_PAY",
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("card"); // wallet is still card underneath
    expect(ctx.cardNetwork).toBe("visa");
    expect(ctx.label).toBe("Card (Apple Pay)");
    expect(ctx.raw).toBe("apple_pay");
  });

  it("card with unknown company → family card, network null", () => {
    const ctx = derivePaymentContext(
      orderWith({ __typename: "CardPaymentDetails", company: "SomethingElse" } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("card");
    expect(ctx.cardNetwork).toBeNull();
    expect(ctx.label).toBe("Card");
  });
});

describe("derivePaymentContext — Klarna", () => {
  it.each([
    ["klarna", "Klarna"],
    ["klarna_pay_later", "Klarna — Pay Later"],
    ["klarna_pay_now", "Klarna — Pay Now"],
    ["klarna_slice_it", "Klarna — Slice It"],
  ])("%s → family klarna, label %s, network null", (name, label) => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "LocalPaymentMethodsPaymentDetails",
        paymentMethodName: name,
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("klarna");
    expect(ctx.label).toBe(label);
    expect(ctx.cardNetwork).toBeNull();
    expect(ctx.raw).toBe(name);
    expect(isNonCardPaymentFamily(ctx.family)).toBe(true);
  });

  it("uppercase/whitespace paymentMethodName is normalized", () => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "LocalPaymentMethodsPaymentDetails",
        paymentMethodName: "  Klarna_Pay_Later  ",
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("klarna");
    expect(ctx.raw).toBe("klarna_pay_later");
  });
});

describe("derivePaymentContext — Affirm (prefix, unverified string)", () => {
  it("affirm → family affirm, network null, raw preserved", () => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "LocalPaymentMethodsPaymentDetails",
        paymentMethodName: "affirm",
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("affirm");
    expect(ctx.label).toBe("Affirm");
    expect(ctx.cardNetwork).toBeNull();
    expect(isNonCardPaymentFamily(ctx.family)).toBe(true);
  });

  it("affirm_pay_monthly (hypothetical variant) still matches by prefix", () => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "LocalPaymentMethodsPaymentDetails",
        paymentMethodName: "affirm_pay_monthly",
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("affirm");
    expect(ctx.raw).toBe("affirm_pay_monthly");
  });
});

describe("derivePaymentContext — other local / fallbacks", () => {
  it("unknown local method (iDEAL) → local_payment_method, non-card-safe", () => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "LocalPaymentMethodsPaymentDetails",
        paymentMethodName: "ideal",
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("local_payment_method");
    expect(ctx.raw).toBe("ideal");
    expect(isNonCardPaymentFamily(ctx.family)).toBe(true);
  });

  it("local method with null name → local_payment_method", () => {
    const ctx = derivePaymentContext(
      orderWith({
        __typename: "LocalPaymentMethodsPaymentDetails",
        paymentMethodName: null,
      } as OrderTransaction["paymentDetails"]),
    );
    expect(ctx.family).toBe("local_payment_method");
    expect(ctx.raw).toBeNull();
  });

  it("gift_card gateway → gift_card family", () => {
    const ctx = derivePaymentContext(orderWith(null, "gift_card"));
    expect(ctx.family).toBe("gift_card");
  });

  it("manual gateway → manual family", () => {
    const ctx = derivePaymentContext(orderWith(null, "manual"));
    expect(ctx.family).toBe("manual");
  });

  it("null order → unknown", () => {
    const ctx = derivePaymentContext(null);
    expect(ctx.family).toBe("unknown");
    expect(ctx.cardNetwork).toBeNull();
  });

  it("no transactions → unknown", () => {
    const ctx = { transactions: [] } as unknown as OrderDetailNode;
    expect(derivePaymentContext(ctx).family).toBe("unknown");
  });
});

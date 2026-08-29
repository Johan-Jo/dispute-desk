import { describe, expect, it } from "vitest";
import {
  classifyPaymentMethod,
  classifyReasonFamily,
} from "@/lib/admin/shopRiskClassify";

describe("classifyReasonFamily — six curated buckets", () => {
  it("routes fraud + authorization reasons to fraud", () => {
    expect(classifyReasonFamily("FRAUDULENT")).toBe("fraud");
    expect(classifyReasonFamily("UNRECOGNIZED")).toBe("fraud");
    expect(classifyReasonFamily("DEBIT_NOT_AUTHORIZED")).toBe("fraud");
  });

  it("routes item-not-received to fulfillment", () => {
    expect(classifyReasonFamily("PRODUCT_NOT_RECEIVED")).toBe("fulfillment");
  });

  it("surfaces refund (CREDIT_NOT_PROCESSED) as its own bucket, not other", () => {
    // Regression: this used to collapse into "other", hiding the
    // single largest category for BNPL-heavy shops.
    expect(classifyReasonFamily("CREDIT_NOT_PROCESSED")).toBe("refund");
  });

  it("routes quality + subscription to their own buckets", () => {
    expect(classifyReasonFamily("PRODUCT_UNACCEPTABLE")).toBe("quality");
    expect(classifyReasonFamily("SUBSCRIPTION_CANCELLED")).toBe("subscription");
  });

  it("keeps general/billing/technical/compliance/unknown in other", () => {
    expect(classifyReasonFamily("GENERAL")).toBe("other");
    expect(classifyReasonFamily("DUPLICATE")).toBe("other"); // Billing
    expect(classifyReasonFamily("BANK_CANNOT_PROCESS")).toBe("other"); // Technical
    expect(classifyReasonFamily("NONCOMPLIANT")).toBe("other"); // Compliance
    expect(classifyReasonFamily(null)).toBe("other");
    expect(classifyReasonFamily("SOMETHING_NEW")).toBe("other");
  });

  it("is case/spacing tolerant (matches the enum normalizer)", () => {
    expect(classifyReasonFamily("credit not processed")).toBe("refund");
  });
});

describe("classifyPaymentMethod — dashboard buckets", () => {
  it("names card + wallets explicitly", () => {
    expect(classifyPaymentMethod("card")).toBe("card");
    expect(classifyPaymentMethod("apple_pay")).toBe("apple_pay");
    expect(classifyPaymentMethod("google_pay")).toBe("google_pay");
    expect(classifyPaymentMethod("shop_pay")).toBe("shop_pay");
  });

  // Shopify emits the Shop Pay wallet as SHOPIFY_PAY, so the column
  // holds `shopify_pay` — the classifier only tested `shop_pay`, and
  // every Shop Pay order fell through to "other".
  it("buckets the stored shopify_pay spelling as shop_pay", () => {
    expect(classifyPaymentMethod("shopify_pay")).toBe("shop_pay");
    expect(classifyPaymentMethod("SHOPIFY_PAY")).toBe("shop_pay");
  });

  it("groups every klarna variant under klarna", () => {
    expect(classifyPaymentMethod("klarna")).toBe("klarna");
    expect(classifyPaymentMethod("klarna_pay_later")).toBe("klarna");
    expect(classifyPaymentMethod("klarna_slice_it")).toBe("klarna");
  });

  it("names paypal, in any casing the gateway arrives in", () => {
    expect(classifyPaymentMethod("paypal")).toBe("paypal");
    expect(classifyPaymentMethod("PayPal")).toBe("paypal");
    expect(classifyPaymentMethod("paypal_express")).toBe("paypal");
  });

  it("folds other real local methods into other", () => {
    expect(classifyPaymentMethod("ideal")).toBe("other");
    expect(classifyPaymentMethod("affirm")).toBe("other");
  });

  // The bug this whole change exists to close: a missing method is a
  // coverage gap, not a payment method. Callers exclude "unknown" from
  // the split; folding it into "other" reported a method nobody used.
  it("separates a missing method from a real uncharted one", () => {
    expect(classifyPaymentMethod(null)).toBe("unknown");
    expect(classifyPaymentMethod(undefined)).toBe("unknown");
    expect(classifyPaymentMethod("")).toBe("unknown");
    expect(classifyPaymentMethod("   ")).toBe("unknown");
  });
});

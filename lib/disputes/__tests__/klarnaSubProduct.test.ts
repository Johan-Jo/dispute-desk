import { describe, it, expect } from "vitest";
import {
  extractKlarnaSubProduct,
  derivePaymentContext,
} from "@/lib/disputes/paymentContext";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

describe("extractKlarnaSubProduct", () => {
  it("reads payment_method_category from the modern receipt shape", () => {
    const receipt = JSON.stringify({
      payment_method_details: { klarna: { payment_method_category: "pay_later" } },
    });
    expect(extractKlarnaSubProduct(receipt)).toBe("pay_later");
  });

  it("reads pay_now", () => {
    const receipt = {
      payment_method_details: { klarna: { payment_method_category: "pay_now" } },
    };
    expect(extractKlarnaSubProduct(receipt)).toBe("pay_now");
  });

  it("reads the legacy charges.data[0] shape", () => {
    const receipt = {
      charges: {
        data: [
          { payment_method_details: { klarna: { payment_method_category: "pay_over_time" } } },
        ],
      },
    };
    expect(extractKlarnaSubProduct(receipt)).toBe("pay_over_time");
  });

  it("reads the latest_charge shape", () => {
    const receipt = {
      latest_charge: {
        payment_method_details: { klarna: { payment_method_category: "pay_in_installments" } },
      },
    };
    expect(extractKlarnaSubProduct(receipt)).toBe("pay_in_installments");
  });

  it("maps an unknown non-empty category to 'other'", () => {
    const receipt = {
      payment_method_details: { klarna: { payment_method_category: "brand_new_thing" } },
    };
    expect(extractKlarnaSubProduct(receipt)).toBe("other");
  });

  it("returns null when no category present or receipt is junk", () => {
    expect(extractKlarnaSubProduct(null)).toBeNull();
    expect(extractKlarnaSubProduct("not json")).toBeNull();
    expect(extractKlarnaSubProduct({})).toBeNull();
    expect(extractKlarnaSubProduct({ payment_method_details: { card: {} } })).toBeNull();
  });
});

describe("derivePaymentContext — Klarna sub-product", () => {
  const klarnaOrder = (receiptJson: unknown): OrderDetailNode =>
    ({
      transactions: [
        {
          id: "1",
          kind: "sale",
          status: "success",
          gateway: "shopify_payments",
          receiptJson,
          paymentDetails: {
            __typename: "LocalPaymentMethodsPaymentDetails",
            paymentMethodName: "klarna",
          },
        },
      ],
    }) as unknown as OrderDetailNode;

  it("labels a pay_later Klarna order and sets the sub-product", () => {
    const ctx = derivePaymentContext(
      klarnaOrder(
        JSON.stringify({
          payment_method_details: { klarna: { payment_method_category: "pay_later" } },
        }),
      ),
    );
    expect(ctx.family).toBe("klarna");
    expect(ctx.klarnaSubProduct).toBe("pay_later");
    expect(ctx.label).toBe("Klarna — Pay Later");
    expect(ctx.cardNetwork).toBeNull();
  });

  it("labels pay_now", () => {
    const ctx = derivePaymentContext(
      klarnaOrder({
        payment_method_details: { klarna: { payment_method_category: "pay_now" } },
      }),
    );
    expect(ctx.klarnaSubProduct).toBe("pay_now");
    expect(ctx.label).toBe("Klarna — Pay Now");
  });

  it("falls back to bare Klarna when the receipt has no category", () => {
    const ctx = derivePaymentContext(klarnaOrder(null));
    expect(ctx.family).toBe("klarna");
    expect(ctx.klarnaSubProduct).toBeNull();
    expect(ctx.label).toBe("Klarna");
  });
});

import { describe, it, expect } from "vitest";
import {
  ORDERS_FOR_BACKFILL_QUERY,
  TYPED_PAYMENT_DETAILS_MEMBERS,
  pickPaymentMethod,
} from "@/lib/shopify/queries/ordersForBackfill";
import { ORDER_FOR_INGEST_QUERY } from "@/lib/shopify/queries/orderForIngest";
import { ORDER_DETAIL_QUERY } from "@/lib/shopify/queries/orders";
import { derivePaymentContext } from "@/lib/disputes/paymentContext";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

/**
 * Regression pin for a SILENT data-loss bug (2026-08-29).
 *
 * Shopify's `PaymentDetails` is a GraphQL union. An inline-fragment
 * spread only matches the members it names; a member with no matching
 * fragment comes back as a bare `{ __typename }` — no error, no
 * warning, just absent fields.
 *
 * Our three order queries spread only `CardPaymentDetails` and
 * `LocalPaymentMethodsPaymentDetails`. PayPal-through-Shopify-Payments
 * is its OWN member (`PaypalWalletPaymentDetails`), so every PayPal
 * order persisted `payment_method = NULL` and an entirely empty
 * risk-signals row — no AVS, CVV, BIN or card brand. On one merchant
 * that was 2,577 of 3,583 Shopify Payments orders in 30 days (72% of
 * payment volume), which read out as "3-DS auth 1%" and a Risk
 * Intelligence page full of structural zeros.
 *
 * These tests fail loudly if a query drops a member again, or if a new
 * member is added to the canonical list without being queried.
 */
describe("PaymentDetails union coverage", () => {
  const QUERIES: Array<[string, string]> = [
    ["ORDERS_FOR_BACKFILL_QUERY", ORDERS_FOR_BACKFILL_QUERY],
    ["ORDER_FOR_INGEST_QUERY", ORDER_FOR_INGEST_QUERY],
    ["ORDER_DETAIL_QUERY", ORDER_DETAIL_QUERY],
  ];

  it.each(QUERIES)(
    "%s spreads every typed PaymentDetails union member",
    (_name, query) => {
      for (const member of TYPED_PAYMENT_DETAILS_MEMBERS) {
        expect(query).toContain(`... on ${member}`);
      }
    },
  );

  it("lists exactly the union members Shopify's schema exposes", () => {
    // Pinned from live introspection of the Admin API PaymentDetails
    // union (2026-01). If Shopify adds a member, this fails first —
    // update the list AND every query above, together.
    expect([...TYPED_PAYMENT_DETAILS_MEMBERS].sort()).toEqual([
      "CardPaymentDetails",
      "LocalPaymentMethodsPaymentDetails",
      "PaypalWalletPaymentDetails",
      "ShopPayInstallmentsPaymentDetails",
    ]);
  });
});

describe("pickPaymentMethod — non-card union members", () => {
  const tx = (paymentDetails: Record<string, unknown>) => [
    {
      kind: "SALE",
      status: "SUCCESS",
      gateway: "shopify_payments",
      receiptJson: null,
      paymentDetails,
    },
  ];

  it("resolves PayPal from the typename even when the name is absent", () => {
    // The live API returned a bare `{__typename}` for these orders, so
    // the typename — not paymentMethodName — must carry the decision.
    expect(
      pickPaymentMethod(tx({ __typename: "PaypalWalletPaymentDetails" })),
    ).toBe("paypal");
  });

  it("resolves Shop Pay Installments from the typename", () => {
    expect(
      pickPaymentMethod(
        tx({ __typename: "ShopPayInstallmentsPaymentDetails" }),
      ),
    ).toBe("shop_pay_installments");
  });

  it("still prefers an explicit paymentMethodName when present", () => {
    expect(
      pickPaymentMethod(
        tx({
          __typename: "PaypalWalletPaymentDetails",
          paymentMethodName: "PayPal",
        }),
      ),
    ).toBe("paypal");
  });

  it("never reports PayPal as a card", () => {
    expect(
      pickPaymentMethod(tx({ __typename: "PaypalWalletPaymentDetails" })),
    ).not.toBe("card");
  });
});

describe("derivePaymentContext — PayPal is non-card", () => {
  const orderWith = (paymentDetails: Record<string, unknown>) =>
    ({
      transactions: [
        {
          id: "gid://shopify/OrderTransaction/1",
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails,
        },
      ],
    }) as unknown as OrderDetailNode;

  it("classifies PayPal as its own family with no card network", () => {
    const ctx = derivePaymentContext(
      orderWith({ __typename: "PaypalWalletPaymentDetails" }),
    );
    expect(ctx.family).toBe("paypal");
    // PayPal carries no card network — AVS/CVV/3DS/CE3.0/FPT must not
    // fire for it, exactly as for Klarna.
    expect(ctx.cardNetwork).toBeNull();
  });

  it("classifies Shop Pay Installments as its own family", () => {
    const ctx = derivePaymentContext(
      orderWith({ __typename: "ShopPayInstallmentsPaymentDetails" }),
    );
    expect(ctx.family).toBe("shop_pay_installments");
    expect(ctx.cardNetwork).toBeNull();
  });
});

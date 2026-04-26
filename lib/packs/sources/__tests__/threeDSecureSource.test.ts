/**
 * 3-D Secure source collector tests.
 *
 * Covers the defensive receipt walk + gateway gating + edge cases.
 */

import { describe, expect, it } from "vitest";
import { collectThreeDSecureEvidence } from "../threeDSecureSource";
import type { BuildContext } from "../../types";
import type { OrderDetailNode, OrderTransaction } from "@/lib/shopify/queries/orders";

function makeCtx(transactions: Partial<OrderTransaction>[]): BuildContext {
  const order = {
    transactions: transactions as OrderTransaction[],
  } as unknown as OrderDetailNode;
  return {
    packId: "p1",
    disputeId: "d1",
    shopId: "s1",
    disputeReason: "fraudulent",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "test.myshopify.com",
    accessToken: "x",
    order,
  };
}

const baseTx = {
  id: "gid://shopify/OrderTransaction/1",
  kind: "SALE",
  status: "SUCCESS",
  paymentDetails: { __typename: "CardPaymentDetails" },
};

describe("threeDSecureSource — gateway gating", () => {
  it("returns no evidence for non-Shopify-Payments gateways", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "paypal",
        receiptJson: {
          payment_method_details: {
            card: { three_d_secure: { authenticated: true } },
          },
        },
      },
    ]);
    const res = await collectThreeDSecureEvidence(ctx);
    expect(res).toEqual([]);
  });

  it("returns no evidence for manual gateway", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "manual",
        receiptJson: { foo: "bar" },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });
});

describe("threeDSecureSource — Shopify Payments receipt walk", () => {
  it("emits MODERATE-eligible payload when authenticated=true", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: {
            card: { three_d_secure: { authenticated: true } },
          },
        },
      },
    ]);
    const [section] = await collectThreeDSecureEvidence(ctx);
    expect(section).toBeTruthy();
    expect(section.fieldsProvided).toEqual(["tds_authentication"]);
    expect(section.data.tdsAuthenticated).toBe(true);
    expect(section.data.tdsVerified).toBe(false);
    expect(section.data.verifiedSource).toBe("shopify_receipt");
  });

  it("does NOT emit when authenticated=false (absence is never a negative signal)", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: {
            card: { three_d_secure: { authenticated: false } },
          },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("does NOT emit when three_d_secure is null (3DS not used on this charge)", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: { card: { three_d_secure: null, brand: "visa" } },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("reads from latest_charge.payment_method_details (modern PaymentIntent shape)", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          latest_charge: {
            payment_method_details: {
              card: { three_d_secure: { authenticated: true } },
            },
          },
        },
      },
    ]);
    const [section] = await collectThreeDSecureEvidence(ctx);
    expect(section).toBeTruthy();
    expect(section.data.tdsAuthenticated).toBe(true);
  });

  it("parses receiptJson when delivered as a string (live Shopify shape)", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: JSON.stringify({
          latest_charge: {
            payment_method_details: {
              card: { three_d_secure: { authenticated: true } },
            },
          },
        }),
      },
    ]);
    const [section] = await collectThreeDSecureEvidence(ctx);
    expect(section).toBeTruthy();
    expect(section.data.tdsAuthenticated).toBe(true);
  });

  it("returns nothing on malformed receiptJson string", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: "not-json{",
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });
});

describe("threeDSecureSource — defensive against shape drift", () => {
  it("returns nothing when receiptJson is null", async () => {
    const ctx = makeCtx([
      { ...baseTx, gateway: "shopify_payments", receiptJson: null },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("returns nothing when receipt has no payment_method_details", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: { id: "ch_x" },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("returns nothing when payment_method_details has no card", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: { payment_method_details: { type: "ach" } },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("returns nothing when card has no three_d_secure subobject", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: { card: { brand: "visa" } },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("returns nothing when authenticated is not a boolean", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: {
            card: { three_d_secure: { authenticated: "yes" } },
          },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("ignores arrays placed at object positions", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: { card: [{ three_d_secure: { authenticated: true } }] },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });
});

describe("threeDSecureSource — transaction selection", () => {
  it("skips when no successful sale or authorization exists", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        kind: "REFUND",
        gateway: "shopify_payments",
        receiptJson: {
          payment_method_details: {
            card: { three_d_secure: { authenticated: true } },
          },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("skips failed transactions", async () => {
    const ctx = makeCtx([
      {
        ...baseTx,
        gateway: "shopify_payments",
        status: "FAILURE",
        receiptJson: {
          payment_method_details: {
            card: { three_d_secure: { authenticated: true } },
          },
        },
      },
    ]);
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });

  it("returns nothing when ctx.order is null", async () => {
    const ctx: BuildContext = {
      packId: "p",
      disputeId: "d",
      shopId: "s",
      disputeReason: null,
      orderGid: null,
      shopDomain: "x",
      accessToken: "y",
      order: null,
    };
    expect(await collectThreeDSecureEvidence(ctx)).toEqual([]);
  });
});

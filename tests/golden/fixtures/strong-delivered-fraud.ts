/**
 * Canonical "strong" fraud case: AVS+CVV match, billing address verified,
 * signature-on-delivery proof. Three distinct strong signals → overall "strong".
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "strong-delivered-fraud",
  description:
    "Fraud reason with AVS+CVV match, billing address match, and signature delivery — three strong signals across three signalIds.",
  disputeReason: "FRAUDULENT",
  disputeAmount: 120.0,
  order: {
    id: "gid://shopify/Order/100001",
    name: "#G1001",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/1",
        status: "SUCCESS",
        displayStatus: "DELIVERED",
        createdAt: "2026-04-01T10:00:00Z",
        updatedAt: "2026-04-03T18:00:00Z",
        deliveredAt: "2026-04-03T18:00:00Z",
        estimatedDeliveryAt: "2026-04-03T00:00:00Z",
        trackingInfo: [
          { number: "1Z999AA10123456784", url: "https://ups.com/track/1Z999AA10123456784", company: "UPS" },
        ],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: { status: "INACTIVE" },
  },
  checklist: [
    { field: "avs_cvv_match", label: "AVS+CVV", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "billing_address_match", label: "Billing match", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "delivery_proof", label: "Delivery proof", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "shipping_tracking", label: "Tracking", status: "available", priority: "recommended", blocking: false, source: "auto_shopify" },
    { field: "order_confirmation", label: "Order record", status: "available", priority: "optional", blocking: false, source: "auto_shopify" },
  ],
  evidencePayloads: {
    avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    billing_address_match: { match: true },
    delivery_proof: { proofType: "signature_confirmed" },
    shipping_tracking: { proofType: "signature_confirmed" },
    order_confirmation: { orderName: "#G1001" },
  },
  packSections: [
    {
      type: "order",
      label: "Order",
      source: "shopify_order",
      data: { orderName: "#G1001", createdAt: "2026-04-01", totalAmount: "120.00", currencyCode: "USD" },
    },
    {
      type: "shipping",
      label: "Fulfillment",
      source: "shopify_fulfillments",
      data: {
        overallStatus: "DELIVERED",
        fulfillments: [
          { status: "SUCCESS", carrier: "UPS", trackingNumber: "1Z999AA10123456784", deliveredAt: "2026-04-03T18:00:00Z" },
        ],
      },
    },
    {
      type: "policy",
      label: "Policies",
      source: "policy_snapshots",
      data: { policies: [{ policyType: "refunds" }, { policyType: "shipping" }] },
    },
  ],
};

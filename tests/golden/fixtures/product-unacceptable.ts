/**
 * PRODUCT_UNACCEPTABLE reason — product family. Customer claims item
 * was defective or not as described. Strongest evidence is the
 * customer's own communication confirming the order matched the
 * product listing, plus refund-policy acceptance at checkout.
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "product-unacceptable",
  description:
    "PRODUCT_UNACCEPTABLE — customer confirms order in support email + refund policy was accepted at checkout. Two strong signals across two signalIds.",
  disputeReason: "PRODUCT_UNACCEPTABLE",
  disputeAmount: 65.0,
  order: {
    id: "gid://shopify/Order/100007",
    name: "#G1007",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/7",
        status: "SUCCESS",
        displayStatus: "DELIVERED",
        createdAt: "2026-04-15T10:00:00Z",
        updatedAt: "2026-04-18T14:00:00Z",
        deliveredAt: "2026-04-18T14:00:00Z",
        estimatedDeliveryAt: null,
        trackingInfo: [{ number: "TRACK7", url: null, company: "FedEx" }],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: null,
  },
  checklist: [
    { field: "product_description", label: "Product listing", status: "available", priority: "recommended", blocking: false, source: "auto_shopify" },
    { field: "customer_communication", label: "Customer comms", status: "available", priority: "critical", blocking: false, source: "manual_upload" },
    { field: "refund_policy", label: "Refund policy", status: "available", priority: "critical", blocking: false, source: "auto_policy" },
  ],
  evidencePayloads: {
    product_description: { title: "Premium leather wallet — black", sku: "WALLET-BLK" },
    customer_communication: { customerConfirmsOrder: true },
    refund_policy: { acceptedAtCheckout: true, acceptanceTimestamp: "2026-04-14T12:00:00Z" },
  },
  packSections: [
    {
      type: "order",
      label: "Order",
      source: "shopify_order",
      data: { orderName: "#G1007", totalAmount: "65.00", currencyCode: "USD" },
    },
    {
      type: "comms",
      label: "Customer communication",
      source: "manual_upload",
      data: {
        emails: [
          { subject: "Re: my order", body: "Got the wallet — exactly as pictured. Thanks!", sentAt: "2026-04-19T08:00:00Z" },
        ],
      },
    },
    {
      type: "policy",
      label: "Policies",
      source: "policy_snapshots",
      data: { policies: [{ policyType: "refunds" }] },
    },
  ],
};

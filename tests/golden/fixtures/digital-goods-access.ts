/**
 * Digital goods scenario: customer downloaded / accessed the product.
 * activity_log decisive + customer_communication confirmation → two strong
 * signals across two signalIds (account_history + communication).
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "digital-goods-access",
  description:
    "INR-style claim on a digital product where access logs prove the customer used the good and a support email confirms purchase.",
  disputeReason: "PRODUCT_NOT_RECEIVED",
  disputeAmount: 49.0,
  order: {
    id: "gid://shopify/Order/100002",
    name: "#G1002",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/2",
        status: "SUCCESS",
        displayStatus: "DELIVERED",
        createdAt: "2026-04-10T12:00:00Z",
        updatedAt: "2026-04-10T12:00:01Z",
        deliveredAt: "2026-04-10T12:00:01Z",
        estimatedDeliveryAt: null,
        trackingInfo: [],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: null,
  },
  checklist: [
    { field: "activity_log", label: "Activity log", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "customer_account_info", label: "Account history", status: "available", priority: "recommended", blocking: false, source: "auto_shopify" },
    { field: "customer_communication", label: "Customer comms", status: "available", priority: "critical", blocking: false, source: "manual_upload" },
    { field: "product_description", label: "Product listing", status: "available", priority: "optional", blocking: false, source: "auto_shopify" },
  ],
  evidencePayloads: {
    activity_log: { decisiveSessionProof: true, digitalAccessUsed: true },
    customer_account_info: { priorUndisputedOrders: 4, totalOrders: 5 },
    customer_communication: { customerConfirmsOrder: true },
    product_description: { title: "Pro license — annual" },
  },
  packSections: [
    {
      type: "access_log",
      label: "Activity log",
      source: "shopify_order",
      data: {
        customerTenure: { totalOrders: 5, customerSince: "2024-08-01" },
        timelineEvents: [
          { createdAt: "2026-04-10T12:01:00Z", message: "Customer downloaded license file" },
        ],
      },
    },
    {
      type: "comms",
      label: "Customer communication",
      source: "manual_upload",
      data: {
        emails: [
          { subject: "Re: my license", body: "Thanks, all working now.", sentAt: "2026-04-12T09:00:00Z" },
        ],
      },
    },
  ],
};

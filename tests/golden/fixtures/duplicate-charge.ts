/**
 * DUPLICATE reason — billing-family case where the customer claims
 * they were charged twice. AVS+CVV match plus billing-address match
 * give us two distinct strong signals across two signalIds, so the
 * generic count-based formula resolves to "strong".
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "duplicate-charge",
  description:
    "DUPLICATE charge dispute — billing match + AVS/CVV match prove the same card authorized; duplicate_explanation is supporting context.",
  disputeReason: "DUPLICATE",
  disputeAmount: 75.0,
  order: {
    id: "gid://shopify/Order/100006",
    name: "#G1006",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/6",
        status: "SUCCESS",
        displayStatus: "DELIVERED",
        createdAt: "2026-04-25T10:00:00Z",
        updatedAt: "2026-04-26T15:00:00Z",
        deliveredAt: "2026-04-26T15:00:00Z",
        estimatedDeliveryAt: null,
        trackingInfo: [{ number: "TRACK6", url: null, company: "USPS" }],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: null,
  },
  checklist: [
    { field: "avs_cvv_match", label: "AVS+CVV", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "billing_address_match", label: "Billing match", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "duplicate_explanation", label: "Duplicate explanation", status: "available", priority: "recommended", blocking: false, source: "manual_note" },
  ],
  evidencePayloads: {
    avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    billing_address_match: { match: true },
    duplicate_explanation: { note: "These are two separate orders placed 4 minutes apart from the same checkout session." },
  },
  packSections: [
    {
      type: "order",
      label: "Order",
      source: "shopify_order",
      data: { orderName: "#G1006", totalAmount: "75.00", currencyCode: "USD" },
    },
  ],
};

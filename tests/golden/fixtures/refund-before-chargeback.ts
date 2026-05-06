/**
 * Fatal-loss scenario: a refund covering the disputed amount has already
 * been issued. Even with otherwise-strong evidence the engine must cap
 * `overall` at "weak" and force `heroVariant` to "hard_to_win".
 *
 * The bank-rebuttal text path NEVER cites the refund (would be a confession);
 * golden test only verifies the gate decision, not the text body.
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "refund-before-chargeback",
  description:
    "Refund issued for the full disputed amount before the chargeback arrived — fatal-loss gate must trigger and cap overall at weak.",
  disputeReason: "FRAUDULENT",
  disputeAmount: 200.0,
  order: {
    id: "gid://shopify/Order/100004",
    name: "#G1004",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/4",
        status: "SUCCESS",
        displayStatus: "DELIVERED",
        createdAt: "2026-03-15T10:00:00Z",
        updatedAt: "2026-03-17T16:00:00Z",
        deliveredAt: "2026-03-17T16:00:00Z",
        estimatedDeliveryAt: null,
        trackingInfo: [{ number: "TRACK4", url: null, company: "UPS" }],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "200.00", currencyCode: "USD" } },
    shopifyProtect: { status: "INACTIVE" },
  },
  checklist: [
    { field: "avs_cvv_match", label: "AVS+CVV", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "delivery_proof", label: "Delivery proof", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
  ],
  evidencePayloads: {
    avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    delivery_proof: { proofType: "signature_confirmed" },
  },
  packSections: [
    {
      type: "order",
      label: "Order",
      source: "shopify_order",
      data: { orderName: "#G1004", totalAmount: "200.00", currencyCode: "USD" },
    },
  ],
};

/**
 * High-risk order: AVS/CVV failed AND IP intelligence flags a VPN. No
 * decisive signals reach the bank-eligible threshold. Engine should return
 * "weak" / "hard_to_win" — no auto-submit.
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "suspicious-risky-order",
  description:
    "AVS+CVV both fail and the customer session was on a VPN — no strong/moderate signals, must resolve to weak.",
  disputeReason: "FRAUDULENT",
  disputeAmount: 90.0,
  order: {
    id: "gid://shopify/Order/100005",
    name: "#G1005",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/5",
        status: "SUCCESS",
        displayStatus: "IN_TRANSIT",
        createdAt: "2026-04-20T08:00:00Z",
        updatedAt: "2026-04-21T08:00:00Z",
        deliveredAt: null,
        estimatedDeliveryAt: "2026-04-25T00:00:00Z",
        trackingInfo: [{ number: "TRACK5", url: null, company: "USPS" }],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: { status: "INACTIVE" },
  },
  checklist: [
    { field: "avs_cvv_match", label: "AVS+CVV", status: "available", priority: "critical", blocking: false, source: "auto_shopify" },
    { field: "ip_location_check", label: "IP & location", status: "available", priority: "recommended", blocking: false, source: "auto_ipinfo" },
    { field: "shipping_tracking", label: "Tracking", status: "available", priority: "recommended", blocking: false, source: "auto_shopify" },
  ],
  evidencePayloads: {
    avs_cvv_match: { avsResultCode: "N", cvvResultCode: "N" },
    ip_location_check: {
      bankEligible: true,
      locationMatch: "match",
      ipinfo: { privacy: { vpn: true, proxy: false, hosting: false } },
    },
    // tracking only, no proofType beyond label-stage → invalid
    shipping_tracking: { proofType: "label_created" },
  },
  packSections: [
    {
      type: "shipping",
      label: "Fulfillment",
      source: "shopify_fulfillments",
      data: {
        overallStatus: "IN_TRANSIT",
        fulfillments: [
          { status: "SUCCESS", carrier: "USPS", trackingNumber: "TRACK5", createdAt: "2026-04-20T08:00:00Z" },
        ],
      },
    },
  ],
};

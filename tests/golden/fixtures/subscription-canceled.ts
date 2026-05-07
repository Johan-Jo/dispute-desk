/**
 * SUBSCRIPTION_CANCELED reason — subscription family. Cardholder
 * claims they cancelled before the disputed billing cycle. Strongest
 * defense is cancellation policy acceptance at checkout combined with
 * customer communication confirming continued use.
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "subscription-canceled",
  description:
    "SUBSCRIPTION_CANCELED — cancellation policy accepted at checkout + customer confirmation of continued use. Two strong signals across two signalIds.",
  disputeReason: "SUBSCRIPTION_CANCELED",
  disputeAmount: 29.0,
  order: {
    id: "gid://shopify/Order/100008",
    name: "#G1008",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        id: "gid://shopify/Fulfillment/8",
        status: "SUCCESS",
        displayStatus: "DELIVERED",
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:01Z",
        deliveredAt: "2026-04-01T00:00:01Z",
        estimatedDeliveryAt: null,
        trackingInfo: [],
        fulfillmentLineItems: { edges: [] },
      },
    ],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: null,
  },
  checklist: [
    { field: "cancellation_policy", label: "Cancellation policy", status: "available", priority: "critical", blocking: false, source: "auto_policy" },
    { field: "customer_communication", label: "Customer comms", status: "available", priority: "critical", blocking: false, source: "manual_upload" },
    { field: "order_confirmation", label: "Order record", status: "available", priority: "optional", blocking: false, source: "auto_shopify" },
  ],
  evidencePayloads: {
    cancellation_policy: { acceptedAtCheckout: true, acceptanceTimestamp: "2026-03-15T10:00:00Z" },
    customer_communication: { customerConfirmsOrder: true },
    order_confirmation: { orderName: "#G1008" },
  },
  packSections: [
    {
      type: "policy",
      label: "Policies",
      source: "policy_snapshots",
      data: { policies: [{ policyType: "terms" }] },
    },
    {
      type: "comms",
      label: "Customer communication",
      source: "manual_upload",
      data: {
        emails: [
          { subject: "Re: subscription status", body: "Yes I'm still using the service, no plans to cancel.", sentAt: "2026-04-10T15:00:00Z" },
        ],
      },
    },
  ],
};

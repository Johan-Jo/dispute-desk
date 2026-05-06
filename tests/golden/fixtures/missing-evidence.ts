/**
 * No evidence at all — empty checklist. Engine returns the early-exit
 * "insufficient" path (strengthReason from the family fallback).
 */

import type { GoldenFixture } from "./index";

export const fixture: GoldenFixture = {
  name: "missing-evidence",
  description:
    "Empty checklist (no evidence collected yet) — should return the insufficient/hard_to_win early exit.",
  disputeReason: "FRAUDULENT",
  disputeAmount: 75.0,
  order: {
    id: "gid://shopify/Order/100003",
    name: "#G1003",
    displayFulfillmentStatus: "UNFULFILLED",
    fulfillments: [],
    totalRefundedSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
    shopifyProtect: null,
  },
  checklist: [],
  evidencePayloads: {},
  packSections: [],
};

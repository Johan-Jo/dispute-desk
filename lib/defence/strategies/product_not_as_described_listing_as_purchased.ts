/**
 * Strategy: listing as purchased (product_not_as_described family).
 *
 * Selected when an order_record fact exists. Frames the representment
 * around what the customer ordered — the items, the variant they selected,
 * the price — and, when a product listing is on record, what the merchant
 * advertised for that item.
 *
 * v2 (2026-09-28, not-as-described plan PR 1). v1 told the model to cite
 * "what title/description was published at the time" and to argue "the
 * listing-as-published matched what was delivered". Neither is on record:
 * no listing was collected at purchase, and a listing shows what was
 * advertised, not what arrived. Selection is unchanged (order_record_present).
 */

import type { StrategySubmodule } from "../types";

export const product_not_as_described_listing_as_purchased: StrategySubmodule = {
  key: "product_not_as_described_listing_as_purchased",
  familyKey: "product_not_as_described",
  displayName: "Listing as purchased",
  // Gated on order_record_present — strategy reads specifically from
  // order_record (line items, variant, title); without it there's
  // nothing concrete to cite.
  predicates: { all: ["order_record_present"] },
  isFallback: false,
  priority: 10,
  promptBody: [
    "STRATEGY FOCUS — listing as purchased:",
    "Build the transactionOverviewArgument and (where appropriate) the executiveSummary around the order record: which items the customer ordered, which variant they selected and at what price.",
    "Cite specific values from the order_record fact (orderName, lineItems if present).",
    "When a product_listing fact is approved, state what the merchant's listing describes for the ordered item, as the listing retrieved for this response. Never present it as the page the customer saw when ordering.",
    "Do not argue subjective product quality, and never conclude that what arrived agreed with the listing. Argue from what was ordered, what the records show, and any documented resolution.",
  ].join("\n"),
  version: 2,
};

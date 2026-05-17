/**
 * Strategy: listing as purchased (product_not_as_described family).
 *
 * Selected when an order_record fact exists. Frames the
 * representment around the listing the customer accepted at checkout —
 * what variant was offered, what they ordered, what was delivered.
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
    "Build the transactionOverviewArgument and (where appropriate) the executiveSummary around the order record: which variant was selected at checkout, what title/description was published at the time, what was delivered.",
    "Cite specific values from the order_record fact (orderName, lineItems if present).",
    "Do not argue subjective product quality. Argue the listing-as-published matched what was delivered.",
  ].join("\n"),
  version: 1,
};

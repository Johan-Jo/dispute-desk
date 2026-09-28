/**
 * Strategy: no return initiated (credit_not_processed family).
 *
 * Selected when a `no_return_initiated` fact is present — i.e. the order's
 * returnStatus is NO_RETURN AND no refund was issued. This is the grounded
 * "no refund was owed" branch of a CREDIT_NOT_PROCESSED dispute: the
 * cardholder claims a refund they were never entitled to, because they
 * never returned the goods.
 *
 * Distinct from `credit_not_processed_refund_record` (which argues a refund
 * WAS processed). These are mutually exclusive by construction — the
 * collector only emits no_return_initiated when no refund exists.
 */

import type { StrategySubmodule } from "../types";

export const credit_not_processed_no_return: StrategySubmodule = {
  key: "credit_not_processed_no_return",
  familyKey: "credit_not_processed",
  displayName: "No return initiated",
  predicates: { all: ["return_not_initiated"] },
  isFallback: false,
  priority: 15,
  promptBody: [
    "STRATEGY FOCUS — no return initiated:",
    "The cardholder claims a refund was not processed. Argue from what Shopify records: \"No return has been recorded in Shopify for this order.\" When a refund policy fact is present, say only that the merchant's refund policy is published on the store (with its link) — never what it requires, never that the customer agreed to it (rule 8d).",
    "Do NOT assert the customer is lying, that they never asked for a return, or that a refund could never be owed. Conclude that, with no return recorded in Shopify, the claim that a refund is outstanding is not supported.",
    "Only argue this when the no_return_initiated fact is present — never speculate about returns.",
  ].join("\n"),
  version: 2,
};

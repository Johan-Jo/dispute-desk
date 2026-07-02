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
    "The cardholder claims a refund was not processed, but no refund was owed: the customer never initiated a return of the goods. Cite the order's return status (no return on record) as the factual basis, and — when an approved refund/return policy fact is present — tie it to the policy the customer agreed to (a refund is contingent on returning the item).",
    "Do NOT assert the customer is lying or that a refund could never be owed. State the facts: no return was initiated and no refund was issued, therefore the claim that a refund is outstanding is not supported.",
    "Only argue this when the no_return_initiated fact is present — never speculate about returns.",
  ].join("\n"),
  version: 1,
};

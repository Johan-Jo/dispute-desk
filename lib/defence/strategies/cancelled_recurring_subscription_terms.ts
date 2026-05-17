/**
 * Strategy: subscription terms (cancelled_recurring family).
 *
 * Selected when subscription_terms facts are on record. Frames the
 * representment around what the customer agreed to and when.
 */

import type { StrategySubmodule } from "../types";

export const cancelled_recurring_subscription_terms: StrategySubmodule = {
  key: "cancelled_recurring_subscription_terms",
  familyKey: "cancelled_recurring",
  displayName: "Subscription terms",
  predicates: { all: ["subscription_terms_present"] },
  isFallback: false,
  priority: 10,
  promptBody: [
    "STRATEGY FOCUS — subscription terms:",
    "Build the policyArgument and (when relevant) transactionOverviewArgument around the subscription's documented terms: renewal cadence, cancellation window, notice requirements.",
    "Cite the specific terms from the approved subscription_terms fact. Never paraphrase from memory.",
  ].join("\n"),
  version: 1,
};

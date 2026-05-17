/**
 * Strategy: policy terms (credit_not_processed family).
 *
 * Selected when refund or cancellation policy facts exist. Frames the
 * representment around what the customer agreed to at checkout.
 */

import type { StrategySubmodule } from "../types";

export const credit_not_processed_policy_terms: StrategySubmodule = {
  key: "credit_not_processed_policy_terms",
  familyKey: "credit_not_processed",
  displayName: "Policy terms",
  predicates: { any: ["policy_disclosed", "policy_accepted"] },
  isFallback: false,
  priority: 20,
  promptBody: [
    "STRATEGY FOCUS — policy terms:",
    "Build the policyArgument around the refund/cancellation policies disclosed and (when supported) accepted at checkout. Cite acceptedAtCheckout=true ONLY when an approved policy_acceptance fact backs it.",
    "Distinguish disclosure from acceptance — disclosure on the merchant site is always citable; acceptance requires the explicit fact.",
  ].join("\n"),
  version: 1,
};

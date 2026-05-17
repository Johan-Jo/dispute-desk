/**
 * Strategy: repeat customer pattern (unauthorized_fraud family).
 *
 * Selected when a prior-customer-history fact carries priorOrderCount > 0.
 * Frames the representment around the cardholder's documented purchase
 * history with the merchant — a pattern inconsistent with a stolen
 * card making an isolated transaction.
 */

import type { StrategySubmodule } from "../types";

export const unauthorized_fraud_repeat_customer_pattern: StrategySubmodule = {
  key: "unauthorized_fraud_repeat_customer_pattern",
  familyKey: "unauthorized_fraud",
  displayName: "Repeat customer pattern",
  predicates: {
    all: ["prior_customer"],
  },
  isFallback: false,
  priority: 20,
  promptBody: [
    "STRATEGY FOCUS — repeat customer pattern:",
    "When approved facts include prior_customer_history with priorOrderCount > 0, surface the count and any disputeFreeHistory flag in transactionOverviewArgument and executiveSummary.",
    "Quote the count: 'The cardholder has N prior undisputed orders with the merchant'.",
    "Frame the pattern as 'consistent with a customer in a continuing relationship with the merchant' — never as 'proof the cardholder authorised this transaction'.",
    "If disputeFreeHistory=true, mention the absence of prior disputes as additional context, but do not draw conclusions about the cardholder's intent for this specific transaction.",
  ].join("\n"),
  version: 1,
};

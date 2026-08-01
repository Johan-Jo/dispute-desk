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
    "When approved facts include prior_customer_history with priorOrderCount > 0, surface the count in transactionOverviewArgument and executiveSummary.",
    "`disputeFreeHistory` is a TRI-STATE and governs the exact wording. Never write the word 'undisputed' unless it is literally true:",
    "  disputeFreeHistory=true  → 'The cardholder has N prior undisputed orders with the merchant', and you may mention the absence of prior disputes as additional context.",
    "  disputeFreeHistory=null  → the prior orders were NOT verified as dispute-free. Write only 'The cardholder has N prior orders with the merchant'. Do NOT write 'undisputed', 'dispute-free', 'clean history', or any equivalent.",
    "  disputeFreeHistory=false → the account HAS prior chargebacks. Do not cite the order count as supporting evidence at all.",
    "Frame the pattern as 'consistent with a customer in a continuing relationship with the merchant' — never as 'proof the cardholder authorised this transaction'.",
  ].join("\n"),
  version: 1,
};

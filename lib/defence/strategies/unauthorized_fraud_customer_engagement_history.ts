/**
 * Strategy: customer engagement history (unauthorized_fraud family).
 *
 * Selected when a customer_communication fact is on record. Frames the
 * representment around documented engagement between the cardholder
 * and the merchant — order confirmations, support exchanges, post-
 * purchase messages — that are consistent with the cardholder having
 * received and acknowledged the order.
 */

import type { StrategySubmodule } from "../types";

export const unauthorized_fraud_customer_engagement_history: StrategySubmodule = {
  key: "unauthorized_fraud_customer_engagement_history",
  familyKey: "unauthorized_fraud",
  displayName: "Customer engagement history",
  predicates: {
    all: ["customer_communication_on_record"],
  },
  isFallback: false,
  priority: 30,
  promptBody: [
    "STRATEGY FOCUS — customer engagement history:",
    "When approved facts include customer_communication with messageCount > 0 or lastMessageAt populated, build the communicationArgument and chronologyArgument around the documented exchange.",
    "Cite messageCount and the last message timestamp when available. If customerConfirmsOrder=true, frame as 'the customer's correspondence on record acknowledges the order' (never as 'the customer admitted the charge was valid').",
    "Reference the engagement as additional context that the cardholder interacted with the merchant around the time of the disputed transaction — never as standalone proof of authorization.",
  ].join("\n"),
  version: 1,
};

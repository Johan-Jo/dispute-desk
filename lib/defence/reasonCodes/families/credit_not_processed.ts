/**
 * Family: credit not processed (Visa 13.6, MC 4860).
 *
 * Bank-side claim: a refund or credit owed to the cardholder was not
 * applied. Cross-module strategy is to surface refund status, policy
 * disclosure, and any documented communication about the refund.
 */

import type { ReasonCodeFamily } from "../../types";

export const credit_not_processed_family: ReasonCodeFamily = {
  key: "credit_not_processed",
  displayName: "Credit not processed",
  moduleKeys: ["credit_not_processed"],
  unmodeledCodes: [],
  fallbackModuleKey: "credit_not_processed",
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};

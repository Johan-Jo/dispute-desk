/**
 * Family: unauthorized fraud (Visa 10.x, MC 4837 family).
 *
 * Bank-side claim: the cardholder did not authorize the transaction.
 * Cross-module strategy is to surface authentication factors specific to
 * the cardholder (AVS, CVV, 3-D Secure when present), billing alignment,
 * and any prior-purchase behaviour that's consistent with a legitimate
 * cardholder session.
 */

import type { ReasonCodeFamily } from "../../types";

export const unauthorized_fraud: ReasonCodeFamily = {
  key: "unauthorized_fraud",
  displayName: "Unauthorized transaction (fraud)",
  moduleKeys: ["visa_10_4_fraud"],
  unmodeledCodes: [],
  fallbackModuleKey: "visa_10_4_fraud",
  // Phase 1: empty overlay. The cross-cutting reminder
  // ("the reason code is the bank's claim, not a merchant-asserted fact")
  // lands here once Phase 4's templated thesis ships, so claim-position
  // language can be enforced at the family layer instead of duplicated
  // in every module promptBody.
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};

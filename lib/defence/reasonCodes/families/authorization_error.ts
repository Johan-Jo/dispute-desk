/**
 * Family: authorization error (Visa 11.x, MC 4808).
 *
 * Bank-side claim: the transaction was processed without proper
 * authorisation — no auth, declined auth, expired auth. No dedicated
 * module yet; codes in this family route to the generic fallback module
 * until specific guidance is written.
 */

import type { ReasonCodeFamily } from "../../types";

export const authorization_error: ReasonCodeFamily = {
  key: "authorization_error",
  displayName: "Authorization error",
  moduleKeys: [],
  unmodeledCodes: [
    "11.1", // Visa — Card Recovery Bulletin
    "11.2", // Visa — Declined Authorization
    "11.3", // Visa — No Authorization
    "4808", // Mastercard — Authorization-Related Chargeback
  ],
  fallbackModuleKey: "generic_fallback",
  overlayPromptBody: "",
  familyAvoid: [],
  prohibitedBankPhrases: [],
  guardedBankPhrases: [],
  version: 1,
};

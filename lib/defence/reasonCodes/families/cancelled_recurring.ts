/**
 * Family: cancelled recurring transaction (Visa 13.2, MC 4841).
 *
 * Bank-side claim: a subscription/recurring charge was billed after the
 * cardholder cancelled. Cross-module strategy is to surface subscription
 * terms, cancellation policy, and service-usage records post-renewal.
 *
 * Naming note: the family key is `cancelled_recurring` (British/PRD
 * spelling) but the underlying module key is `canceled_recurring`
 * (American). The mismatch is deliberate — see notes in the registry
 * and tests.
 */

import type { ReasonCodeFamily } from "../../types";

export const cancelled_recurring: ReasonCodeFamily = {
  key: "cancelled_recurring",
  displayName: "Cancelled recurring transaction",
  moduleKeys: ["canceled_recurring"],
  unmodeledCodes: [],
  fallbackModuleKey: "canceled_recurring",
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};

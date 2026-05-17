/**
 * Family: processing error (Visa 12.x except 12.6, MC 4831).
 *
 * Bank-side claim: the transaction was processed in error — late
 * presentment, wrong amount, wrong currency, wrong account number,
 * invalid data. No dedicated module yet; codes in this family route
 * to the generic fallback module until specific guidance is written.
 */

import type { ReasonCodeFamily } from "../../types";

export const processing_error: ReasonCodeFamily = {
  key: "processing_error",
  displayName: "Processing error",
  moduleKeys: [],
  unmodeledCodes: [
    "12.1", // Visa — Late Presentment
    "12.2", // Visa — Incorrect Transaction Code
    "12.3", // Visa — Incorrect Currency
    "12.4", // Visa — Incorrect Account Number
    "12.5", // Visa — Incorrect Amount
    "12.7", // Visa — Invalid Data
    "4831", // Mastercard — Transaction Amount Differs
  ],
  fallbackModuleKey: "generic_fallback",
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};

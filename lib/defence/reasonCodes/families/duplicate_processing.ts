/**
 * Family: duplicate processing (Visa 12.6, MC 4834).
 *
 * Bank-side claim: the cardholder was charged twice for the same
 * transaction. Cross-module strategy is to surface distinctness markers
 * (order ids, auth ids, timestamps, items) and any refund record when
 * one of the charges was reversed.
 */

import type { ReasonCodeFamily } from "../../types";

export const duplicate_processing_family: ReasonCodeFamily = {
  key: "duplicate_processing",
  displayName: "Duplicate processing",
  moduleKeys: ["duplicate_processing"],
  unmodeledCodes: [],
  fallbackModuleKey: "duplicate_processing",
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};

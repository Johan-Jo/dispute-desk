/**
 * Family: fallback.
 *
 * Resolves for any reason code not claimed by a more specific family
 * (and for null/undefined inputs). Routes to the generic fallback
 * module.
 */

import type { ReasonCodeFamily } from "../../types";

export const fallback_family: ReasonCodeFamily = {
  key: "fallback",
  displayName: "Generic representment",
  moduleKeys: ["generic_fallback"],
  unmodeledCodes: [],
  fallbackModuleKey: "generic_fallback",
  overlayPromptBody: "",
  familyAvoid: [],
  version: 1,
};

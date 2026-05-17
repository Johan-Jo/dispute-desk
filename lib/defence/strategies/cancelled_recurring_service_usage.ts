/**
 * Strategy: service usage post-renewal (cancelled_recurring family).
 *
 * Selected when service_access or digital_access facts show the
 * customer continued to use the service after the renewal charge —
 * supports the merchant's position that the service was being used.
 */

import type { StrategySubmodule } from "../types";

export const cancelled_recurring_service_usage: StrategySubmodule = {
  key: "cancelled_recurring_service_usage",
  familyKey: "cancelled_recurring",
  displayName: "Service usage post-renewal",
  predicates: { any: ["digital_access_used", "service_delivered"] },
  isFallback: false,
  priority: 20,
  promptBody: [
    "STRATEGY FOCUS — service usage post-renewal:",
    "Cite usage timestamps from approved facts. Frame as 'the service was accessed after the disputed renewal charge'.",
    "Do NOT claim the cardholder personally accessed — claim 'the customer account' accessed. Bank-side fraud claims may or may not be true; the record shows account-level activity.",
  ].join("\n"),
  version: 1,
};

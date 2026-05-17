import type { StrategySubmodule } from "../types";

export const credit_not_processed_narrow_fallback: StrategySubmodule = {
  key: "credit_not_processed_narrow_fallback",
  familyKey: "credit_not_processed",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when neither a refund record nor policy facts are available. Present what IS on record (order timeline, customer communication) without claiming a refund was issued.",
    "If the merchant's position is 'no refund was owed under policy', the policy fact must be present — do not speculate.",
  ].join("\n"),
  version: 1,
};

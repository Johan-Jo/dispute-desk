import type { StrategySubmodule } from "../types";

export const cancelled_recurring_narrow_fallback: StrategySubmodule = {
  key: "cancelled_recurring_narrow_fallback",
  familyKey: "cancelled_recurring",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when neither subscription terms nor post-renewal usage facts are available. Cite the order record and any documented communication factually.",
    "Never claim 'the customer never cancelled' without a fact backing it.",
  ].join("\n"),
  version: 1,
};

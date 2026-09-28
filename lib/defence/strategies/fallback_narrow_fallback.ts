import type { StrategySubmodule } from "../types";

export const fallback_narrow_fallback: StrategySubmodule = {
  key: "fallback_narrow_fallback",
  familyKey: "fallback",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback (generic family):",
    "Unknown / unmapped reason codes. Cite the strongest approved facts available (payment authentication, delivery confirmation, customer communication, policy disclosure) without invoking scheme-specific rules.",
    "Argue fewer points, firmly: state what each record shows as a fact. Never qualify the merchant's own records or describe the evidence as limited.",
  ].join("\n"),
  version: 1,
};

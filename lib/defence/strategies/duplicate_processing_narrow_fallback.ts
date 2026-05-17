import type { StrategySubmodule } from "../types";

export const duplicate_processing_narrow_fallback: StrategySubmodule = {
  key: "duplicate_processing_narrow_fallback",
  familyKey: "duplicate_processing",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when neither distinctness markers nor a refund record exist. Present the order timeline factually; do not assert duplication or distinctness.",
  ].join("\n"),
  version: 1,
};

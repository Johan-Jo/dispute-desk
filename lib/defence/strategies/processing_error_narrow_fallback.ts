import type { StrategySubmodule } from "../types";

export const processing_error_narrow_fallback: StrategySubmodule = {
  key: "processing_error_narrow_fallback",
  familyKey: "processing_error",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback (processing_error family):",
    "Processing-error disputes (late presentment, wrong currency, wrong amount, invalid data) hinge on the transaction record itself. Frame the representment around the order record's transaction details: amount, currency, capture timestamp, descriptor.",
    "Do not argue scheme-rule technicalities the merchant hasn't supplied as approved facts. Stick to what's on record.",
  ].join("\n"),
  version: 1,
};

import type { StrategySubmodule } from "../types";

export const product_not_as_described_narrow_fallback: StrategySubmodule = {
  key: "product_not_as_described_narrow_fallback",
  familyKey: "product_not_as_described",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when complaint-evidence is thin. Argue from the listing-as-purchased fact (always present) and any policy disclosures on record.",
    "Never argue the product was 'acceptable' — that's subjective. Argue what the merchant offered, what the customer accepted at checkout, and what evidence supports the merchant's position.",
  ].join("\n"),
  version: 1,
};

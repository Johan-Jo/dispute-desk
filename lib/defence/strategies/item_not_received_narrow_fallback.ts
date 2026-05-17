import type { StrategySubmodule } from "../types";

export const item_not_received_narrow_fallback: StrategySubmodule = {
  key: "item_not_received_narrow_fallback",
  familyKey: "item_not_received",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when delivery / access evidence is thin. Frame around what tracking DOES show (carrier hand-off, in-transit scans, last-known status) without claiming delivery.",
    "If a tracking number exists but no delivery confirmation, describe the tracking timeline as far as it goes — never claim the package was delivered.",
    "Use hedged framing throughout: 'The available records indicate…', 'The submitted tracking shows…'.",
  ].join("\n"),
  version: 1,
};

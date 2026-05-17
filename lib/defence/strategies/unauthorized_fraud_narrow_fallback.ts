/**
 * Strategy: narrow fallback (unauthorized_fraud family).
 *
 * Always available. Selected when no other strategy in the family
 * qualifies, OR appended as the last block whenever the bundle is
 * built — so the writer always has the narrow-mode framing rules
 * cached for narrow-packaging cases.
 *
 * The fallback ensures every family has at least one strategy emitted,
 * so the strategy bundle block is non-empty for every dispute and the
 * prompt-cache layout stays stable.
 */

import type { StrategySubmodule } from "../types";

export const unauthorized_fraud_narrow_fallback: StrategySubmodule = {
  key: "unauthorized_fraud_narrow_fallback",
  familyKey: "unauthorized_fraud",
  displayName: "Narrow fallback",
  predicates: {},
  isFallback: true,
  priority: 0,
  promptBody: [
    "STRATEGY FOCUS — narrow fallback:",
    "Use this framing when the approved evidence is thin. Keep the executiveSummary to one paragraph of ≤4 sentences. Use hedged phrasing throughout: 'The available records support…', 'The available evidence is consistent with…', 'The submitted records indicate…'.",
    "Cite only the facts that are actually in approvedFacts; never fill gaps.",
    "Do not draw declarative reason-code conclusions. Do not assert the dispute is invalid. The bank decides — your job is to present what's on record clearly.",
  ].join("\n"),
  version: 1,
};

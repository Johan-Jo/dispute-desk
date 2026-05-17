/**
 * Strategy: distinct markers (duplicate_processing family).
 *
 * Selected when a duplicate_explanation fact carries distinct=true.
 * Frames the two transactions as separately authorised events.
 */

import type { StrategySubmodule } from "../types";

export const duplicate_processing_distinct_markers: StrategySubmodule = {
  key: "duplicate_processing_distinct_markers",
  familyKey: "duplicate_processing",
  displayName: "Distinct transaction markers",
  predicates: { all: ["duplicate_distinct_markers"] },
  isFallback: false,
  priority: 10,
  promptBody: [
    "STRATEGY FOCUS — distinct transaction markers:",
    "Frame the transactions as DISTINCT. Cite the unique order ids, separate auth ids, distinct timestamps, and any different line items recorded in the approved facts.",
    "Frame as 'each charge is a separately recorded transaction' — never as 'definitively not a duplicate', which overclaims.",
  ].join("\n"),
  version: 1,
};

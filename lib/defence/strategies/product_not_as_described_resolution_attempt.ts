/**
 * Strategy: documented resolution attempt (product_not_as_described
 * family).
 *
 * Selected when customer_communication is on record. Frames the
 * representment around any merchant attempts to resolve the complaint
 * before the chargeback.
 */

import type { StrategySubmodule } from "../types";

export const product_not_as_described_resolution_attempt: StrategySubmodule = {
  key: "product_not_as_described_resolution_attempt",
  familyKey: "product_not_as_described",
  displayName: "Documented resolution attempt",
  predicates: { all: ["customer_communication_on_record"] },
  isFallback: false,
  priority: 20,
  promptBody: [
    "STRATEGY FOCUS — documented resolution attempt:",
    "Build the communicationArgument around the documented merchant↔customer exchange. Frame any offer of refund/exchange/replacement as a good-faith resolution attempt.",
    "Do NOT speculate about customer intent. Quote what's in the messages on record.",
    "If the customer rejected or didn't respond to an offer, present that factually without editorialising.",
  ].join("\n"),
  version: 1,
};

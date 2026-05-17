/**
 * Strategy: delivery proof stack (item_not_received family).
 *
 * Selected when a delivery_proof/shipping_tracking fact carries
 * proofType='delivered' or 'signature'. Frames the representment
 * around the carrier-recorded delivery event.
 */

import type { StrategySubmodule } from "../types";

export const item_not_received_delivery_proof_stack: StrategySubmodule = {
  key: "item_not_received_delivery_proof_stack",
  familyKey: "item_not_received",
  displayName: "Delivery proof stack",
  predicates: { all: ["delivery_confirmed"] },
  isFallback: false,
  priority: 10,
  promptBody: [
    "STRATEGY FOCUS — delivery proof stack:",
    "Build the fulfillmentArgument and executiveSummary around the carrier delivery record. When proofType=signature, lead with the captured signature. When proofType=delivered (no signature), describe the carrier's delivery confirmation without overclaiming signature capture.",
    "Cite carrier, deliveredAt, and deliveredToVerifiedAddress when present in the approved fact value.",
    "Never claim delivery to a specific address unless deliveredToVerifiedAddress=true is in the fact.",
  ].join("\n"),
  version: 1,
};

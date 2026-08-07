/**
 * Strategy: delivery proof stack (item_not_received family).
 *
 * Selected when a delivery_proof/shipping_tracking fact carries
 * proofType='delivered_confirmed' or 'signature_confirmed'. Frames
 * the representment around the carrier-recorded delivery event.
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
    "Build the fulfillmentArgument and executiveSummary around the carrier delivery record. When proofType=signature_confirmed, lead with the captured signature. When proofType=delivered_confirmed (no signature), describe the carrier's delivery confirmation without overclaiming signature capture.",
    "Cite carrier, trackingNumber, trackingUrl and deliveredAt when present in the approved fact value — these are the identifiers an issuer can independently verify.",
    "NEVER state which physical address received the parcel, and never describe an address as verified, matched, confirmed, AVS-confirmed, the cardholder's, or the same as the billing address. DisputeDesk holds no evidence tying a delivery event to a specific address. Write 'the carrier confirmed delivery of the shipment', not 'delivered to the cardholder's verified address'.",
  ].join("\n"),
  // v2 (PR-C1, 2026-08-07): the `deliveredToVerifiedAddress` licence is
  // removed. That flag was derived from a billing-vs-shipping city comparison
  // with no AVS input and is now a retired payload key.
  version: 2,
};

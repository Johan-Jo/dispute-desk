/**
 * Strategy: shipment in the carrier's possession (item_not_received family).
 *
 * Selected when the cited shipment is bank-citable and in transit, and there is
 * no carrier-confirmed delivery (non-receipt plan §4.1(b), §5.2, §6.4 row
 * "in transit, commitment unknown"). Before it, an in-transit parcel produced
 * nothing citable and blume-box #360980's letter argued from "no return was
 * initiated" instead — which on this claim concedes the cardholder's premise.
 *
 * P0 wording is STATUS ONLY: we hold Shopify's per-shipment status and the
 * time we read it, not carrier events, so no sentence may present a date as
 * when the parcel moved (§5.2).
 */

import type { StrategySubmodule } from "../types";

export const item_not_received_carrier_possession: StrategySubmodule = {
  key: "item_not_received_carrier_possession",
  familyKey: "item_not_received",
  displayName: "Shipment in carrier possession",
  predicates: { all: ["shipment_in_carrier_possession"], none: ["delivery_confirmed"] },
  isFallback: false,
  priority: 5,
  promptBody: [
    "STRATEGY FOCUS — shipment in the carrier's possession:",
    "The cited shipment has been handed to the carrier and the carrier's record shows it in transit. Build the fulfillmentArgument and executiveSummary on that record: name the carrier and the trackingNumber exactly as they appear in the approved fact value, and state that the carrier's record shows the shipment in transit.",
    "Date the status only as a RETRIEVAL date, using carrierStatusObservedAt: 'the carrier's record shows the shipment in transit (status as retrieved on <date>)'. Never present that date, or any other, as when the parcel moved, was scanned or will arrive.",
    "Never claim or imply delivery, receipt, arrival at an address, or who holds the parcel. No progress verbs ('is moving', 'progressing', 'on its way to the cardholder').",
    "When the fact carries `shipments`, describe every shipment as the family rules say, each only by its own entry; a transit statement belongs only to the entry whose proofType is in_transit.",
  ].join("\n"),
  version: 2,
};

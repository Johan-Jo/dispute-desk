/**
 * Strategy: refund resolved (duplicate_processing family).
 *
 * Selected when a refund record exists. Most cases where one of the
 * charges WAS a duplicate are best resolved by showing the merchant
 * already refunded the duplicate side.
 */

import type { StrategySubmodule } from "../types";

export const duplicate_processing_refund_resolved: StrategySubmodule = {
  key: "duplicate_processing_refund_resolved",
  familyKey: "duplicate_processing",
  displayName: "Duplicate already refunded",
  predicates: { all: ["refund_processed"] },
  isFallback: false,
  priority: 20,
  promptBody: [
    "STRATEGY FOCUS — duplicate already refunded:",
    "When a refund_record with refundStatus=processed is on record, frame the merchant's position as: one of the two charges has been refunded, so the cardholder is not currently double-billed.",
    "Cite the refund amount and date if available. Never argue the chargeback is invalid because of the refund — argue the cardholder's underlying concern has been addressed.",
  ].join("\n"),
  version: 1,
};

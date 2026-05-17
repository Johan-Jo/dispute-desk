/**
 * Strategy: refund processed (credit_not_processed family).
 *
 * Selected when an approved refund_record fact carries
 * refundStatus='processed'. Most direct way to defeat this dispute.
 */

import type { StrategySubmodule } from "../types";

export const credit_not_processed_refund_record: StrategySubmodule = {
  key: "credit_not_processed_refund_record",
  familyKey: "credit_not_processed",
  displayName: "Refund processed",
  predicates: { all: ["refund_processed"] },
  isFallback: false,
  priority: 10,
  promptBody: [
    "STRATEGY FOCUS — refund processed:",
    "Lead with the refund record: refundStatus, refundedAt, refunded amount. Frame as the direct rebuttal — the credit the cardholder is claiming was unprocessed is actually on record.",
    "If the refund was processed AFTER the chargeback was opened, present it factually as 'subsequently processed' — don't pretend the timing was different.",
  ].join("\n"),
  version: 1,
};

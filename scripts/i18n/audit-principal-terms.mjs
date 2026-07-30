#!/usr/bin/env node
/**
 * Print the principal user-facing terms across all six locales as a
 * markdown table. Used for translation-consistency review — surfaces
 * cases where the same concept (e.g. "FRAUDULENT") is translated
 * differently in different namespaces of the same locale.
 *
 * Run: node scripts/i18n/audit-principal-terms.mjs
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const LOCALES = ["en", "sv", "de", "es", "fr", "pt"];

const cats = {};
for (const l of LOCALES) {
  cats[l] = JSON.parse(
    fs.readFileSync(path.join(repoRoot, `messages/${l}.json`), "utf8"),
  );
}

function lookup(obj, dotted) {
  const parts = dotted.split(".");
  let n = obj;
  for (const p of parts) {
    if (n === null || typeof n !== "object" || !(p in n)) return undefined;
    n = n[p];
  }
  return n;
}

function table(title, rows) {
  console.log(`\n## ${title}\n`);
  console.log(`| Key | ${LOCALES.join(" | ")} |`);
  console.log(`|---|${LOCALES.map(() => "---").join("|")}|`);
  for (const row of rows) {
    const cells = LOCALES.map((l) => {
      const v = lookup(cats[l], row.key);
      return typeof v === "string" ? v : "—";
    });
    console.log(`| **${row.label}** | ${cells.join(" | ")} |`);
  }
}

// 14 Shopify dispute reason codes, both label namespaces
const REASON_CODES = [
  "BANK_CANNOT_PROCESS",
  "CREDIT_NOT_PROCESSED",
  "CUSTOMER_INITIATED",
  "DEBIT_NOT_AUTHORIZED",
  "DUPLICATE",
  "FRAUDULENT",
  "GENERAL",
  "INCORRECT_ACCOUNT_DETAILS",
  "INSUFFICIENT_FUNDS",
  "NONCOMPLIANT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELLED",
  "UNRECOGNIZED",
];

table(
  "Dispute reasons (terse) — disputeReasons.*",
  REASON_CODES.map((c) => ({ label: c, key: `disputeReasons.${c}` })),
);

table(
  "Dispute reasons (merchant-facing) — disputes.workspaceShell.merchantReasonLabel.*",
  REASON_CODES.map((c) => ({
    label: c,
    key: `disputes.workspaceShell.merchantReasonLabel.${c}`,
  })),
);

table("Strength labels — disputes.workspaceShell.strengthLabel.*", [
  { label: "strong", key: "disputes.workspaceShell.strengthLabel.strong" },
  { label: "moderate", key: "disputes.workspaceShell.strengthLabel.moderate" },
  { label: "weak", key: "disputes.workspaceShell.strengthLabel.weak" },
]);

table("Case strength pills — disputes.caseStrength.*", [
  { label: "strong", key: "disputes.caseStrength.strong" },
  { label: "moderate", key: "disputes.caseStrength.moderate" },
  { label: "weak", key: "disputes.caseStrength.weak" },
]);

table("Reason family labels — disputes.reasonFamilyLabel.*", [
  { label: "fraud", key: "disputes.reasonFamilyLabel.fraud" },
  { label: "delivery", key: "disputes.reasonFamilyLabel.delivery" },
  { label: "product", key: "disputes.reasonFamilyLabel.product" },
  { label: "refund", key: "disputes.reasonFamilyLabel.refund" },
  { label: "subscription", key: "disputes.reasonFamilyLabel.subscription" },
  { label: "billing", key: "disputes.reasonFamilyLabel.billing" },
  { label: "digital", key: "disputes.reasonFamilyLabel.digital" },
  { label: "general", key: "disputes.reasonFamilyLabel.general" },
]);

table("Dispute families (taxonomy) — disputeFamilies.*", [
  { label: "Fraud", key: "disputeFamilies.Fraud" },
  { label: "Refund", key: "disputeFamilies.Refund" },
  { label: "General", key: "disputeFamilies.General" },
  { label: "Authorization", key: "disputeFamilies.Authorization" },
  { label: "Billing", key: "disputeFamilies.Billing" },
  { label: "Compliance", key: "disputeFamilies.Compliance" },
  { label: "Fulfillment", key: "disputeFamilies.Fulfillment" },
  { label: "Technical", key: "disputeFamilies.Technical" },
]);

table("Core domain nouns (singular, as rendered in tables / pills)", [
  { label: "Dispute", key: "disputes.detailPageTitle" },
  { label: "Dispute (table column)", key: "table.disputeId" },
  { label: "Pack", key: "table.pack" },
  { label: "Evidence", key: "disputes.workspaceShell.tabs.evidence" },
  { label: "Reason (table)", key: "table.reason" },
  { label: "Status (table)", key: "table.status" },
  { label: "Customer (table)", key: "table.customer" },
  { label: "Amount (table)", key: "table.amount" },
  { label: "Order (table)", key: "table.order" },
  { label: "Deadline (table)", key: "table.deadline" },
]);

table("Chargeback (analytics phrasing) — dashboard.chargeback*", [
  { label: "rate", key: "dashboard.chargebackRate" },
  { label: "rate subtext", key: "dashboard.chargebackRateSubtext" },
  { label: "threshold healthy", key: "dashboard.chargebackRateThresholdHealthy" },
  { label: "threshold watch", key: "dashboard.chargebackRateThresholdWatch" },
  { label: "threshold high risk", key: "dashboard.chargebackRateThresholdHigh" },
]);

// 19 dispute-type / package-type codes (packs.disputeTypeLabel covers
// the 14 reasons plus 5 aliases: FRAUD, PNR, NOT_AS_DESCRIBED,
// SUBSCRIPTION, REFUND, DIGITAL).
const PACK_TYPE_CODES = [
  "FRAUD",
  "FRAUDULENT",
  "PNR",
  "PRODUCT_NOT_RECEIVED",
  "NOT_AS_DESCRIBED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION",
  "SUBSCRIPTION_CANCELLED",
  "REFUND",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE",
  "DIGITAL",
  "GENERAL",
  "NONCOMPLIANT",
  "UNRECOGNIZED",
  "DEBIT_NOT_AUTHORIZED",
  "CUSTOMER_INITIATED",
  "BANK_CANNOT_PROCESS",
  "INCORRECT_ACCOUNT_DETAILS",
  "INSUFFICIENT_FUNDS",
];
table(
  "Dispute / pack type labels — packs.disputeTypeLabel.*",
  PACK_TYPE_CODES.map((c) => ({
    label: c,
    key: `packs.disputeTypeLabel.${c}`,
  })),
);

table("Pack / dispute status — status.*", [
  { label: "needsResponse", key: "status.needsResponse" },
  { label: "underReview", key: "status.underReview" },
  { label: "won", key: "status.won" },
  { label: "lost", key: "status.lost" },
  { label: "unknown", key: "status.unknown" },
  { label: "savedToShopify", key: "status.savedToShopify" },
  { label: "needsReview", key: "status.needsReview" },
  { label: "building", key: "status.building" },
  { label: "blocked", key: "status.blocked" },
  { label: "readyToSave", key: "status.readyToSave" },
  { label: "draft", key: "status.draft" },
  { label: "queued", key: "status.queued" },
  { label: "failed", key: "status.failed" },
  { label: "ready", key: "status.ready" },
  { label: "complete", key: "status.complete" },
  { label: "inProgress", key: "status.inProgress" },
  { label: "active", key: "status.active" },
  { label: "pending", key: "status.pending" },
]);

table("Submission states — disputeTimeline.submissionStates.*", [
  { label: "not_saved", key: "disputeTimeline.submissionStates.not_saved" },
  { label: "saved_to_shopify", key: "disputeTimeline.submissionStates.saved_to_shopify" },
  { label: "submitted_confirmed", key: "disputeTimeline.submissionStates.submitted_confirmed" },
  { label: "submission_uncertain", key: "disputeTimeline.submissionStates.submission_uncertain" },
  { label: "manual_submission_reported", key: "disputeTimeline.submissionStates.manual_submission_reported" },
]);

table("Outcomes — disputeTimeline.outcomes.*", [
  { label: "won", key: "disputeTimeline.outcomes.won" },
  { label: "lost", key: "disputeTimeline.outcomes.lost" },
  { label: "partially_won", key: "disputeTimeline.outcomes.partially_won" },
  { label: "accepted", key: "disputeTimeline.outcomes.accepted" },
  { label: "refunded", key: "disputeTimeline.outcomes.refunded" },
  { label: "canceled", key: "disputeTimeline.outcomes.canceled" },
  { label: "expired", key: "disputeTimeline.outcomes.expired" },
  { label: "closed_other", key: "disputeTimeline.outcomes.closed_other" },
]);

table("Signal labels — disputes.signalLabel.*", [
  { label: "payment_auth", key: "disputes.signalLabel.payment_auth" },
  { label: "billing_match", key: "disputes.signalLabel.billing_match" },
  { label: "delivery", key: "disputes.signalLabel.delivery" },
  { label: "ip_location", key: "disputes.signalLabel.ip_location" },
  { label: "device_session", key: "disputes.signalLabel.device_session" },
  { label: "communication", key: "disputes.signalLabel.communication" },
  { label: "account_history", key: "disputes.signalLabel.account_history" },
  { label: "order_record", key: "disputes.signalLabel.order_record" },
  { label: "product_listing", key: "disputes.signalLabel.product_listing" },
  { label: "policy_refund", key: "disputes.signalLabel.policy_refund" },
  { label: "policy_shipping", key: "disputes.signalLabel.policy_shipping" },
  { label: "policy_cancellation", key: "disputes.signalLabel.policy_cancellation" },
  { label: "duplicate_explanation", key: "disputes.signalLabel.duplicate_explanation" },
  { label: "supplementary_documents", key: "disputes.signalLabel.supplementary_documents" },
  { label: "fraud_screening", key: "disputes.signalLabel.fraud_screening" },
]);

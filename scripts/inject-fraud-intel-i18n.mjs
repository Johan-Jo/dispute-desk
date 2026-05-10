// One-shot: injects the `fraudIntel` namespace into every locale file
// under messages/. English baseline used everywhere; native-language
// localizations follow as a separate translation pass.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "messages";

const NAMESPACE = "fraudIntel";

const KEYS = {
  title: "Fraud risk overview",
  subtitle:
    "Operational context from Shopify's fraud analysis — never a fraud-prevention decision tool.",
  window30: "Last 30 days",
  window90: "Last 90 days",
  window365: "Last 365 days",
  windowAll: "All time",
  analyzingTitle: "Analyzing your order history",
  analyzingBody:
    "We've analyzed {count} orders so far. The risk overview unlocks the moment we finish.",
  failedTitle: "We hit a snag analyzing your orders",
  failedBody:
    "Our background job didn't complete. We'll retry automatically — refresh in a few minutes.",
  kpiAcceptanceRate: "Acceptance rate",
  tooltipAcceptanceRate:
    "Share of analyzed orders Shopify classified as low or medium risk. Orders without completed fraud analysis are excluded.",
  kpiHighRiskRate: "High-risk orders",
  tooltipHighRiskRate:
    "Share of orders Shopify classified as HIGH risk during fraud analysis.",
  kpiFraudDisputeRate: "Fraud dispute rate",
  tooltipFraudDisputeRate:
    "Share of orders that became a Shopify Payments fraud dispute (reason = FRAUDULENT) in this window.",
  kpiHighRiskFulfilled: "High-risk fulfilled",
  tooltipHighRiskFulfilled:
    "Of orders classified HIGH risk, the share that still reached a fulfilled state. A high number can signal operational exposure.",
  kpiProtectCoverage: "Shopify Protect coverage",
  tooltipProtectCoverage:
    "Of order value Shopify Protect was eligible to underwrite, the share marked PROTECTED.",
  kpiProtectSubtext: "Protected value ÷ eligible value",
  kpiOrdersAnalyzed: "Orders analyzed",
  tooltipOrdersAnalyzed:
    "Total Shopify orders covered by this window. Backfill anchors to the historical scope granted to the app.",
  kpiOrdersSubtext: "{window}",
  kpiSubtextFraction: "{num} of {den}",
  kpiSubtextOf: "{num} of {total}",
  kpiUnavailable: "Not enough data",
};

function injectInto(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const obj = JSON.parse(raw);
  if (obj[NAMESPACE]) {
    // Merge — keep any existing translated keys, add missing ones.
    obj[NAMESPACE] = { ...KEYS, ...obj[NAMESPACE] };
  } else {
    obj[NAMESPACE] = { ...KEYS };
  }
  // Preserve key order: existing keys first, fraudIntel at the end.
  const ordered = {};
  for (const k of Object.keys(obj)) {
    if (k !== NAMESPACE) ordered[k] = obj[k];
  }
  ordered[NAMESPACE] = obj[NAMESPACE];
  writeFileSync(filePath, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  return Object.keys(obj[NAMESPACE]).length;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
for (const f of files) {
  const path = join(DIR, f);
  const n = injectInto(path);
  console.log(`  ${f}: ${n} keys in fraudIntel namespace`);
}
console.log("done");

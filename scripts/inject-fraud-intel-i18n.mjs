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
  queuedTitle: "Preparing your fraud-risk overview",
  queuedBody:
    "We've queued up an analysis of your historical orders. This usually starts within a few minutes — refresh in a bit to see progress.",
  analyzingTitle: "Analyzing your order history",
  analyzingBody:
    "We've analyzed {count} orders so far. The risk overview unlocks the moment we finish.",
  failedTitle: "We hit a snag analyzing your orders",
  failedBody:
    "Our background job didn't complete. We'll retry automatically — refresh in a few minutes.",
  kpiAcceptanceRate: "Acceptance rate",
  tooltipAcceptanceRate:
    "Acceptance rate is calculated from orders classified by Shopify as low or medium risk. Orders without completed fraud analysis are excluded.",
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
  // ── Insight banner + initial-analysis page ──────────────────────
  bannerHeadline: "We analyzed {count} historical Shopify orders.",
  bannerBody:
    "{high}% of recent orders were classified as high-risk by Shopify's fraud analysis. {fulfilled}% of Shopify high-risk orders were still fulfilled. You can now monitor fraud-risk exposure, operational patterns, and dispute trends directly inside DisputeDesk.",
  bannerHealthLine: "Current chargeback health: {status}",
  bannerHealth_good: "Good standing",
  bannerHealth_at_risk: "At risk",
  bannerHealth_elevated: "Elevated risk",
  bannerHealth_unknown: "Not yet measured",
  bannerCtaRiskProfile: "View Risk Profile",
  bannerCtaChargebackHealth: "Understand Chargeback Health",
  pageTitle: "Initial Analysis",
  pageSubtitle:
    "Operational context from Shopify's fraud signals — not a fraud-prevention decision.",
  pageHeadline: "We analyzed {count} historical Shopify orders.",
  pageBody:
    "{high}% of recent orders were classified as high-risk by Shopify's fraud analysis. {fulfilled}% of those high-risk orders were still fulfilled. Use this view to monitor exposure, operational patterns, and dispute trends.",
  pageScopeNoteDefault:
    "Your store granted the default order-history scope, so this analysis covers the trailing 60 days. The window expands automatically once Shopify approves extended history access.",
  pageSection90d: "Last 90 days",
  riskBreakdownTitle: "Shopify risk classification breakdown",
  riskHigh: "High",
  riskMedium: "Medium",
  riskLow: "Low",
  riskPending: "Pending analysis",
  riskNone: "No classification",
  chargebackHealthTitle: "Chargeback health",
  chargebackHealthExplain:
    "Calculated from your trailing 90-day chargeback rate. Industry monitoring thresholds align with card-network programs.",
  chargebackHealthBands:
    "Good < 0.40% · At risk 0.40–0.60% · Elevated > 0.60%",
  whatThisMeansTitle: "What this means",
  whatThisMeansBody:
    "Fraud-risk classification is one operational signal among many. DisputeDesk treats it as context for dispute correlation and merchant operations — never as a verdict on individual orders.",
  // ── Scope-upgrade nudge ─────────────────────────────────────────
  scopeUpgradeTitle: "Unlock your full order history",
  scopeUpgradeBody:
    "DisputeDesk now supports analyzing your full historical orders, not just the last 60 days. Re-authorize to expand the risk overview with seasonality, long-window trends, and risk-to-dispute correlation.",
  scopeUpgradeCta: "Re-authorize on Shopify",
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

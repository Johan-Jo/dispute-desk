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
    "Share of analyzed orders that Shopify cleared or rated low/medium risk. Orders still pending fraud analysis are excluded; orders Shopify marked as having no risk indicators are counted as accepted.",
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
  bannerHealth_good: "Within healthy band",
  bannerHealth_at_risk: "Approaching threshold",
  bannerHealth_elevated: "Above threshold",
  bannerHealth_unknown: "Not yet measured",
  bannerHealthInsufficient:
    "Building baseline — too few recent orders to surface a meaningful rate yet.",
  bannerCtaRiskAnalysis: "Open Risk Analysis",
  bannerCtaDisputeQueue: "Open Dispute Queue",
  // Legacy keys preserved for backwards-compat in case any locale
  // file still references them; safe to remove once the embedded UI
  // is verified on prod.
  bannerCtaRiskProfile: "Open Risk Analysis",
  bannerCtaChargebackHealth: "Open Dispute Queue",
  chargebackHealthInsufficientTitle: "Insufficient dispute history",
  chargebackHealthInsufficientBody:
    "We've observed {count} orders in the last 90 days — not enough to classify chargeback health into a meaningful band. The verdict surfaces automatically once volume increases.",
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
  riskNone: "Cleared",
  chargebackHealthTitle: "Chargeback health",
  chargebackHealthExplain:
    "Calculated from your trailing 90-day chargeback rate. Industry monitoring thresholds align with card-network programs.",
  chargebackHealthBands:
    "Good < 0.40% · At risk 0.40–0.60% · Elevated > 0.60%",
  whatThisMeansTitle: "What this means",
  whatThisMeansBody:
    "Fraud-risk classification is one operational signal among many. DisputeDesk treats it as context for dispute correlation and merchant operations — never as a verdict on individual orders.",
  // ── Tier 2: compact insight strip on the embedded dashboard ─────
  // Replaces the previous 6-card fraud panel + dismissible banner
  // with a single observational card. Three sentences, one CTA.
  stripTitle: "Operational insights",
  stripBody:
    "We've analyzed {count} historical Shopify orders. {high}% were classified high-risk by Shopify's fraud analysis. {fulfilled}% of those high-risk orders were still fulfilled.",
  stripPreparingBody:
    "Preparing operational insights — your historical analysis is still in progress. The summary lands here once it finishes.",
  stripCta: "View operational analysis",
  // ── Risk-bucket definitions (Initial Analysis page) ─────────────
  // The "Cleared" bucket is the largest one on most healthy stores
  // and the most easily misread. The genuinely confusing part is
  // Cleared vs Low — both look like "safe orders" but Shopify treats
  // them differently. The info banner at the top of the breakdown
  // card addresses that head-on; the per-bucket definitions below
  // the table back it up.
  breakdownExplainTitle: "What these mean",
  // Top-of-card info banner addressing the Low-vs-Cleared question.
  breakdownExplainBannerTitle:
    "Cleared vs Low — what's the difference?",
  breakdownExplainBannerBody:
    "Low means Shopify found explicit POSITIVE signals (returning customer, billing/shipping match, established email domain). Cleared means Shopify analyzed the order but found no strong signals in either direction — no red flags AND no positive endorsements. Both are safe to accept; Low just has more positive evidence behind it. On a healthy store the majority of orders end up in Cleared simply because most customers don't trigger anything noteworthy.",
  // Per-bucket definitions — rewritten to make the Low/Cleared
  // distinction explicit in the row text too.
  breakdownExplainHigh:
    "Shopify detected multiple NEGATIVE signals (e.g. VPN use, parcel-forwarder address, billing/shipping mismatch in a high-fraud region). Recommended for manual review.",
  breakdownExplainMedium:
    "A few concerning or ambiguous signals worth a second look (e.g. first-time customer, order placed outside the store's typical hours).",
  breakdownExplainLow:
    "Shopify found explicit POSITIVE signals — returning customer with successful prior orders, billing/shipping match, established email domain. High confidence the order is legitimate.",
  breakdownExplainPending:
    "Shopify hasn't finished its fraud check on this order yet — a verdict appears later.",
  breakdownExplainCleared:
    "Shopify completed its analysis but didn't find strong signals in either direction — no red flags AND no explicit positive indicators. Different from Low: Low means \"I see reasons to trust this\"; Cleared means \"I see no reason to flag this.\" Most orders end up here on a healthy store.",
  // ── Scope-upgrade nudge ─────────────────────────────────────────
  scopeUpgradeTitle: "Unlock your full order history",
  scopeUpgradeBody:
    "DisputeDesk now supports analyzing your full historical orders, not just the last 60 days. Re-authorize to expand the risk overview with seasonality, long-window trends, and risk-to-dispute correlation.",
  scopeUpgradeCta: "Re-authorize on Shopify",
};

// Keys we want to FORCE-overwrite even if a locale file already has them
// — used when copy is reframed (e.g. verdict labels softened from
// "Good standing" / "At risk" / "Elevated risk" to observational
// "Within healthy band" / "Approaching threshold" / "Above threshold").
// Add a key here for one run, then remove it once translations have
// caught up. Empty in steady state.
const FORCE_OVERRIDE = new Set([]);

function injectInto(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const obj = JSON.parse(raw);
  if (obj[NAMESPACE]) {
    // Merge — keep existing translations EXCEPT for keys in
    // FORCE_OVERRIDE, where the English baseline wins.
    const existing = obj[NAMESPACE];
    const merged = { ...KEYS, ...existing };
    for (const k of FORCE_OVERRIDE) {
      if (KEYS[k] !== undefined) merged[k] = KEYS[k];
    }
    obj[NAMESPACE] = merged;
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

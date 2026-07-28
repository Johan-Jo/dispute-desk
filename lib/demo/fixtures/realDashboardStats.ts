/**
 * Fixture matching the real `DashboardStats` shape used by the embedded
 * dashboard at `app/(embedded)/app/page.tsx`. Mirrors every field on
 * `DashboardStats` so the real React components render without complaints.
 *
 * Pull-through plan: when the dashboard shape changes upstream, update
 * this file in the same commit (TypeScript will catch missing/extra fields
 * at build time because demo pages will type-check against the real type).
 */

import { DEMO_DISPUTES } from "./disputes";
import type { DashboardStats } from "@/app/(embedded)/app/dashboardHelpers";

const ACTIVE_DISPUTES = DEMO_DISPUTES.filter((d) => d.status !== "covered").length;
const STRONG_DISPUTES = DEMO_DISPUTES.filter((d) => d.strength === "strong").length;
const TOTAL_AT_RISK = Math.round(
  DEMO_DISPUTES.filter((d) => d.status !== "covered").reduce((s, d) => s + d.amount, 0) * 100,
) / 100;

// Annotated as `DashboardStats` on purpose: the dashboard gained `*Split`
// fields (activeSplit … operationalSplit) after this fixture was written,
// and because the export was previously untyped those omissions compiled
// clean but crashed at runtime (`s.operationalSplit["new"]` → "Cannot read
// properties of undefined"). The annotation makes any future field addition
// a build failure here instead of a broken demo landing page.
export const DEMO_DASHBOARD_STATS_REAL: DashboardStats = {
  // Counts
  activeDisputes: ACTIVE_DISPUTES,
  winRate: 87,
  packCount: STRONG_DISPUTES,
  amountAtRisk: TOTAL_AT_RISK,
  amountRecovered: 4287.5,
  amountLost: 420,
  currencyCode: "USD",
  otherCurrencyCounts: {},
  disputesWon: 14,
  disputesLost: 2,
  totalClosed: 17,
  avgTimeToSubmit: 0.4,
  avgTimeToClose: 12.3,

  // Period-over-period deltas
  activeDisputesChange: -8,
  winRateChange: 12,
  amountAtRiskChange: -22,
  amountRecoveredChange: 34,
  disputesWonChange: 16,

  // Counts by phase/group
  inquiryCount: 1,
  chargebackCount: 5,
  needsAttentionCount: 1,

  // ── Inquiry/chargeback splits (Dashboard v3) ─────────────────────
  // Each split reconciles with its headline number: 5 chargebacks + 1
  // inquiry across the active window.
  activeSplit: { cb: 5, inq: 1 },
  atRiskSplit: { cb: 5, inq: 1 },
  winSplit: { cb: 13, inq: 1 },
  recoveredSplit: { cb: 13, inq: 1 },
  closedSplit: { cb: 16, inq: 1 },
  outcomeSplit: {
    won: { cb: 13, inq: 1 },
    lost: { cb: 2, inq: 0 },
    accepted: { cb: 1, inq: 0 },
    refunded: { cb: 0, inq: 0 },
  },
  operationalSplit: {
    new: { cb: 0, inq: 0 },
    action_needed: { cb: 0, inq: 0 },
    needs_review: { cb: 1, inq: 0 },
    ready_to_submit: { cb: 3, inq: 0 },
    in_progress: { cb: 0, inq: 0 },
  },
  winRatePctSplit: { cb: 5, inq: 1 },
  disputeRate: 0.42,
  disputeRateCbPct: 0.35,
  disputeRateInqPct: 0.07,

  // Breakdowns
  statusBreakdown: {
    ready_to_submit: 3,
    needs_review: 1,
    covered: 1,
    blocked: 1,
  },
  outcomeBreakdown: {
    won: 14,
    lost: 2,
    accepted: 1,
    refunded: 0,
  },
  operationalBreakdown: {
    new: 0,
    action_needed: 0,
    needs_review: 1,
    ready_to_submit: 3,
    in_progress: 0,
  },
  operationalClosedCount: 17,
  actionNeededDisputeId: "dp-2406",
  submissionBreakdown: {
    submitted_to_shopify: 0,
    submitted_to_bank: 0,
  },

  // Charts
  winRateTrend: [72, 78, 80, 84, 85, 87],
  // Labels must be `packs.disputeTypeLabel.*` keys (uppercase Shopify
  // reason codes), not pretty English strings — DashboardInsights
  // translates them via `tPacks(disputeTypeLabel.${label})`.
  disputeCategories: [
    { label: "FRAUDULENT", value: 2, cb: 2, inq: 0 },
    { label: "PRODUCT_NOT_RECEIVED", value: 2, cb: 2, inq: 0 },
    { label: "SUBSCRIPTION_CANCELLED", value: 1, cb: 0, inq: 1 },
    { label: "CREDIT_NOT_PROCESSED", value: 1, cb: 1, inq: 0 },
  ],

  recentActivity: [
    { id: "a-1", disputeId: "dp-2401", orderName: "#1027", eventType: "pack_created", description: "Score: 92%, 8 evidence items collected", eventAt: "2026-01-15T10:00:00Z", actorType: "system" },
    { id: "a-2", disputeId: "dp-2402", orderName: "#1031", eventType: "pack_created", description: "Score: 88%, 5 evidence items collected", eventAt: "2026-01-15T09:42:00Z", actorType: "system" },
    { id: "a-3", disputeId: "dp-2406", orderName: "#1039", eventType: "dispute_opened", description: "Chargeback opened — Product not received", eventAt: "2026-01-15T08:31:00Z", actorType: "system" },
    { id: "a-4", disputeId: "dp-prev-01", orderName: "#1003", eventType: "status_changed", description: "Submitted → Won", eventAt: "2026-01-14T17:12:00Z", actorType: "system" },
    { id: "a-5", disputeId: "dp-prev-02", orderName: "#1011", eventType: "evidence_saved_to_shopify", description: "5 evidence fields sent to Shopify", eventAt: "2026-01-14T14:08:00Z", actorType: "merchant" },
    { id: "a-6", disputeId: "dp-2403", orderName: "#1018", eventType: "pack_created", description: "Score: 85%, 5 evidence items collected", eventAt: "2026-01-14T10:55:00Z", actorType: "system" },
  ],

  // Chargeback rate (PRD §8)
  chargebackRate: 0.42,
  chargebackRateChange: -0.3,
  chargebackRateNumerator: 6,
  chargebackRateDenominator: 1432,
  chargebackRateAvailable: true,
  chargebackRateLowVolume: false,
  chargebackRateLastSyncedAt: "2026-01-15T09:00:00Z",
};

export const DEMO_RECENT_ACTIVITY_REAL = DEMO_DASHBOARD_STATS_REAL.recentActivity;

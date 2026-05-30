import { DEMO_DISPUTES } from "./disputes";
import type { DemoDashboardStats, DemoActivityEvent, DemoDispute } from "./types";

const NEEDS_ACTION_STATUSES = new Set<DemoDispute["status"]>([
  "ready_to_submit",
  "needs_review",
]);

const totalAtRisk = DEMO_DISPUTES.filter((d) => d.status !== "covered").reduce((sum, d) => sum + d.amount, 0);

export const DEMO_DASHBOARD_STATS: DemoDashboardStats = {
  needsActionCount: DEMO_DISPUTES.filter((d) => NEEDS_ACTION_STATUSES.has(d.status)).length,
  urgentCount: DEMO_DISPUTES.filter((d) => d.status === "needs_review").length,
  amountAtRisk: Math.round(totalAtRisk * 100) / 100,
  amountRecovered30d: 4_287.5,
  strongCasesCount: DEMO_DISPUTES.filter((d) => d.strength === "strong").length,
  awaitingResponseCount: 2,
  winRate30d: 87,
  outcomeBreakdown: {
    won: 14,
    lost: 2,
    accepted: 1,
    refunded: 0,
  },
};

export const DEMO_ACTIVITY: DemoActivityEvent[] = [
  { id: "a-1", at: "2026-01-15T10:00:00Z", type: "pack_created", disputeId: "dp-2401", orderName: "#1027", description: "Auto-built Strong defence pack — 8 evidence items" },
  { id: "a-2", at: "2026-01-15T09:42:00Z", type: "pack_created", disputeId: "dp-2402", orderName: "#1031", description: "Auto-built Strong defence pack — fulfillment confirmed" },
  { id: "a-3", at: "2026-01-15T08:31:00Z", type: "dispute_opened", disputeId: "dp-2406", orderName: "#1039", description: "Parked for review — fulfillment evidence incomplete" },
  { id: "a-4", at: "2026-01-14T17:12:00Z", type: "dispute_won", disputeId: "dp-prev-01", orderName: "#1003", description: "Bank ruled in your favor — $189.00 recovered" },
  { id: "a-5", at: "2026-01-14T14:08:00Z", type: "evidence_saved", disputeId: "dp-prev-02", orderName: "#1011", description: "Evidence saved to Shopify — 5 fields submitted" },
  { id: "a-6", at: "2026-01-14T10:55:00Z", type: "pack_created", disputeId: "dp-2403", orderName: "#1018", description: "Auto-built Strong defence pack — 11 prior charges + policy" },
  { id: "a-7", at: "2026-01-13T16:30:00Z", type: "dispute_won", disputeId: "dp-prev-03", orderName: "#0998", description: "Bank ruled in your favor — $341.50 recovered" },
];

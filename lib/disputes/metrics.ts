/**
 * Shared dispute metrics query layer.
 *
 * Single source of truth for dispute aggregation. Used by:
 * - GET /api/dashboard/stats (shop-scoped, merchant view)
 * - GET /api/admin/metrics (cross-shop, admin view)
 *
 * All queries use the normalized dispute fields from Phase 1.
 */

import { getServiceClient } from "@/lib/supabase/server";

export interface MetricsOptions {
  /** Shop ID for shop-scoped metrics. Omit for cross-shop (admin). */
  shopId?: string;
  /** Period start (ISO). Omit for all-time. */
  periodFrom?: string;
  /** Period end (ISO). Defaults to now. */
  periodTo?: string;
}

export interface DisputeMetrics {
  // Counts
  activeDisputes: number;
  disputesWon: number;
  disputesLost: number;
  totalClosed: number;

  // Financials
  amountAtRisk: number;
  amountRecovered: number;
  amountLost: number;
  recoveryRate: number;
  currencyCode: string;

  // Rates
  winRate: number;

  // Timing (days, null if no data)
  avgTimeToSubmit: number | null;
  avgTimeToClose: number | null;

  // Breakdowns
  statusBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;

  // Phase
  inquiryCount: number;
  chargebackCount: number;
  needsAttentionCount: number;

  // Submission & deadline rates
  submissionRate: number;
  deadlineMissRate: number;

  // Period-over-period (null when no comparison available)
  activeDisputesChange: number | null;
  winRateChange: number | null;
  amountAtRiskChange: number | null;
  disputesWonChange: number | null;
  amountRecoveredChange: number | null;
  submissionRateChange: number | null;
  deadlineMissRateChange: number | null;

  // Admin-only (null when shop-scoped)
  overriddenCount: number | null;
  syncIssueCount: number | null;
  disputesWithNotesCount: number | null;
}

const ACTIVE_NORMALIZED = [
  "new", "in_progress", "needs_review", "ready_to_submit",
  "action_needed", "submitted", "submitted_to_shopify",
  "waiting_on_issuer", "submitted_to_bank",
];

function pctChange(curr: number, prev: number | null): number | null {
  if (prev === null) return null;
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export async function computeDisputeMetrics(
  opts: MetricsOptions,
): Promise<DisputeMetrics> {
  const sb = getServiceClient();
  const { shopId, periodFrom, periodTo } = opts;
  const periodEnd = periodTo ?? new Date().toISOString();

  // ── Fetch current period disputes ─────────────────────────────────────
  let q = sb
    .from("disputes")
    .select("id, status, amount, currency_code, phase, needs_review, normalized_status, final_outcome, submission_state, submitted_at, closed_at, initiated_at, due_at, outcome_amount_recovered, outcome_amount_lost, has_admin_override, sync_health, needs_attention, last_event_at");

  if (shopId) q = q.eq("shop_id", shopId);
  if (periodFrom) q = q.gte("created_at", periodFrom);
  q = q.lte("created_at", periodEnd);

  const { data } = await q;
  const list = (data ?? []) as Record<string, unknown>[];

  // ── Fetch previous period (for comparison) ────────────────────────────
  let prevList: Record<string, unknown>[] = [];
  if (periodFrom) {
    const periodMs = new Date(periodEnd).getTime() - new Date(periodFrom).getTime();
    const prevFrom = new Date(new Date(periodFrom).getTime() - periodMs).toISOString();
    let pq = sb
      .from("disputes")
      .select("id, status, amount, normalized_status, final_outcome, outcome_amount_recovered, submission_state, submitted_at, due_at");
    if (shopId) pq = pq.eq("shop_id", shopId);
    pq = pq.gte("created_at", prevFrom).lt("created_at", periodFrom);
    const { data: prev } = await pq;
    prevList = (prev ?? []) as Record<string, unknown>[];
  }

  // ── Active disputes ───────────────────────────────────────────────────
  const active = list.filter((d) =>
    ACTIVE_NORMALIZED.includes(String(d.normalized_status ?? "new")),
  );
  const activeDisputes = active.length;
  const amountAtRisk = active.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // ── Win/Loss (final_outcome based) ────────────────────────────────────
  const won = list.filter((d) => d.final_outcome === "won");
  const lost = list.filter((d) => d.final_outcome === "lost");
  const disputesWon = won.length;
  const disputesLost = lost.length;
  const winLossDenom = disputesWon + disputesLost;
  const winRate = winLossDenom > 0 ? Math.round((disputesWon / winLossDenom) * 100) : 0;

  // ── Financial outcomes ────────────────────────────────────────────────
  const amountRecovered = list.reduce(
    (s, d) => s + (Number(d.outcome_amount_recovered) || 0), 0,
  );
  const amountLost = list.reduce(
    (s, d) => s + (Number(d.outcome_amount_lost) || 0), 0,
  );
  const financialTotal = amountRecovered + amountLost;
  const recoveryRate = financialTotal > 0
    ? Math.round((amountRecovered / financialTotal) * 100)
    : 0;

  const totalClosed = list.filter((d) => d.closed_at != null).length;

  // ── Timing ────────────────────────────────────────────────────────────
  const submittedDisputes = list.filter(
    (d) => d.submitted_at && d.initiated_at,
  );
  const avgTimeToSubmit = submittedDisputes.length > 0
    ? submittedDisputes.reduce((s, d) => {
        const ms = new Date(String(d.submitted_at)).getTime() - new Date(String(d.initiated_at)).getTime();
        return s + Math.max(0, ms);
      }, 0) / submittedDisputes.length / (24 * 60 * 60 * 1000)
    : null;

  const closedDisputes = list.filter((d) => d.closed_at && d.initiated_at);
  const avgTimeToClose = closedDisputes.length > 0
    ? closedDisputes.reduce((s, d) => {
        const ms = new Date(String(d.closed_at)).getTime() - new Date(String(d.initiated_at)).getTime();
        return s + Math.max(0, ms);
      }, 0) / closedDisputes.length / (24 * 60 * 60 * 1000)
    : null;

  // ── Breakdowns ────────────────────────────────────────────────────────
  const statusBreakdown: Record<string, number> = {};
  for (const d of list) {
    const ns = String(d.normalized_status ?? "new");
    statusBreakdown[ns] = (statusBreakdown[ns] ?? 0) + 1;
  }

  const outcomeBreakdown: Record<string, number> = {};
  for (const d of list) {
    if (d.final_outcome) {
      const fo = String(d.final_outcome);
      outcomeBreakdown[fo] = (outcomeBreakdown[fo] ?? 0) + 1;
    }
  }

  // ── Phase counts ──────────────────────────────────────────────────────
  const inquiryCount = active.filter((d) => d.phase === "inquiry").length;
  const chargebackCount = active.filter((d) => d.phase !== "inquiry").length;
  const needsAttentionCount = list.filter((d) => d.needs_attention === true).length;

  // ── Currency ──────────────────────────────────────────────────────────
  const currencyCounts: Record<string, number> = {};
  for (const d of list) {
    const c = String(d.currency_code ?? "USD");
    currencyCounts[c] = (currencyCounts[c] ?? 0) + 1;
  }
  const currencyCode = Object.entries(currencyCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  // ── Submission rate (% of active disputes with evidence submitted) ───
  const submittedEvidence = active.filter((d) => {
    const ss = d.submission_state as string | null;
    return ss && ss !== "not_saved";
  }).length;
  const submissionRate = activeDisputes > 0
    ? Math.round((submittedEvidence / activeDisputes) * 100)
    : 0;

  // ── Deadline miss rate (% of disputes with due dates that were missed)
  const now = new Date();
  const withDueDate = list.filter((d) => d.due_at != null);
  const missedDeadline = withDueDate.filter((d) => {
    const due = new Date(String(d.due_at));
    if (due >= now) return false;
    const sa = d.submitted_at ? new Date(String(d.submitted_at)) : null;
    return !sa || sa > due;
  }).length;
  const deadlineMissRate = withDueDate.length > 0
    ? Math.round((missedDeadline / withDueDate.length) * 100)
    : 0;

  // ── Period-over-period ────────────────────────────────────────────────
  const prevActive = prevList.filter((d) =>
    ACTIVE_NORMALIZED.includes(String(d.normalized_status ?? "new")),
  );
  const prevActiveCount = periodFrom ? prevActive.length : null;
  const prevAmountAtRisk = periodFrom
    ? prevActive.reduce((s, d) => s + (Number(d.amount) || 0), 0)
    : null;
  const prevWon = prevList.filter((d) => d.final_outcome === "won").length;
  const prevLost = prevList.filter((d) => d.final_outcome === "lost").length;
  const prevDenom = prevWon + prevLost;
  const prevWinRate = periodFrom && prevDenom > 0
    ? Math.round((prevWon / prevDenom) * 100)
    : periodFrom ? 0 : null;
  const prevRecovered = periodFrom
    ? prevList.reduce((s, d) => s + (Number(d.outcome_amount_recovered) || 0), 0)
    : null;

  const prevSubmittedEvidence = periodFrom
    ? prevActive.filter((d) => {
        const ss = d.submission_state as string | null;
        return ss && ss !== "not_saved";
      }).length
    : null;
  const prevSubmissionRate = periodFrom && prevActive.length > 0
    ? Math.round(((prevSubmittedEvidence ?? 0) / prevActive.length) * 100)
    : periodFrom ? 0 : null;

  const prevWithDueDate = periodFrom
    ? prevList.filter((d) => d.due_at != null)
    : [];
  const prevMissed = prevWithDueDate.filter((d) => {
    const due = new Date(String(d.due_at));
    const prevPeriodEnd = new Date(periodFrom!);
    if (due >= prevPeriodEnd) return false;
    const sa = d.submitted_at ? new Date(String(d.submitted_at)) : null;
    return !sa || sa > due;
  }).length;
  const prevDeadlineMissRate = periodFrom && prevWithDueDate.length > 0
    ? Math.round((prevMissed / prevWithDueDate.length) * 100)
    : periodFrom ? 0 : null;

  // ── Admin-only metrics (cross-shop) ───────────────────────────────────
  let overriddenCount: number | null = null;
  let syncIssueCount: number | null = null;
  let disputesWithNotesCount: number | null = null;

  if (!shopId) {
    overriddenCount = list.filter((d) => d.has_admin_override === true).length;
    syncIssueCount = list.filter(
      (d) => d.sync_health !== "ok" || d.needs_attention === true,
    ).length;

    // Count disputes with notes (separate query)
    const { count: notesCount } = await sb
      .from("dispute_notes")
      .select("dispute_id", { count: "exact", head: true });
    disputesWithNotesCount = notesCount ?? 0;
  }

  return {
    activeDisputes,
    disputesWon,
    disputesLost,
    totalClosed,
    amountAtRisk,
    amountRecovered,
    amountLost,
    recoveryRate,
    currencyCode,
    winRate,
    avgTimeToSubmit: avgTimeToSubmit !== null ? Math.round(avgTimeToSubmit * 10) / 10 : null,
    avgTimeToClose: avgTimeToClose !== null ? Math.round(avgTimeToClose * 10) / 10 : null,
    statusBreakdown,
    outcomeBreakdown,
    inquiryCount,
    chargebackCount,
    needsAttentionCount,
    activeDisputesChange: pctChange(activeDisputes, prevActiveCount),
    winRateChange: prevWinRate !== null ? winRate - prevWinRate : null,
    amountAtRiskChange: pctChange(amountAtRisk, prevAmountAtRisk),
    disputesWonChange: pctChange(disputesWon, periodFrom ? prevWon : null),
    amountRecoveredChange: pctChange(amountRecovered, prevRecovered),
    submissionRate,
    deadlineMissRate,
    submissionRateChange: prevSubmissionRate !== null ? submissionRate - prevSubmissionRate : null,
    deadlineMissRateChange: prevDeadlineMissRate !== null ? deadlineMissRate - prevDeadlineMissRate : null,
    overriddenCount,
    syncIssueCount,
    disputesWithNotesCount,
  };
}

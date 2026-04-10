import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PeriodKey = "24h" | "7d" | "30d" | "all";

const ACTIVE_STATUSES = [
  "needs_response",
  "under_review",
  "building",
  "blocked",
  "ready",
  "saved_to_shopify",
];

function sinceDate(period: PeriodKey): Date | null {
  if (period === "all") return null;
  const now = new Date();
  const ms =
    period === "24h"
      ? 24 * 60 * 60 * 1000
      : period === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/**
 * GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all
 *
 * Returns KPIs matching the portal dashboard:
 *   activeDisputes, winRate, packCount, amountAtRisk
 * Plus legacy / chart fields:
 *   totalDisputes, revenueRecovered, avgResponseTime,
 *   winRateTrend, disputeCategories
 * And period-over-period change values for the 4 main KPIs.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const period = (req.nextUrl.searchParams.get("period") ?? "30d") as PeriodKey;
  const since = sinceDate(period);

  const sb = getServiceClient();

  // ── Current period disputes ──────────────────────────────────────────────
  let query = sb
    .from("disputes")
    .select("id, status, amount, currency_code, created_at, due_at, reason, phase, needs_review")
    .eq("shop_id", shopId);
  if (since) query = query.gte("created_at", since.toISOString());
  const { data: disputes, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = disputes ?? [];

  // ── Previous period disputes (for % change) ──────────────────────────────
  let prevActiveCount: number | null = null;
  let prevWinRate: number | null = null;
  let prevAmountAtRisk: number | null = null;

  if (since) {
    const periodMs = Date.now() - since.getTime();
    const prevSince = new Date(since.getTime() - periodMs);
    const { data: prevDisputes } = await sb
      .from("disputes")
      .select("id, status, amount")
      .eq("shop_id", shopId)
      .gte("created_at", prevSince.toISOString())
      .lt("created_at", since.toISOString());

    const prev = prevDisputes ?? [];
    const prevActive = prev.filter((d) => ACTIVE_STATUSES.includes(d.status ?? ""));
    prevActiveCount = prevActive.length;
    prevAmountAtRisk = prevActive.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const prevWon = prev.filter((d) => d.status === "won").length;
    const prevLost = prev.filter((d) => d.status === "lost").length;
    const prevResolved = prevWon + prevLost;
    prevWinRate = prevResolved > 0 ? Math.round((prevWon / prevResolved) * 100) : null;
  }

  // ── Evidence packs ───────────────────────────────────────────────────────
  const { count: packCount } = await sb
    .from("evidence_packs")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  // ── Compute current KPIs ─────────────────────────────────────────────────
  const active = list.filter((d) => ACTIVE_STATUSES.includes(d.status ?? ""));
  const activeDisputes = active.length;
  const amountAtRisk = active.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // Lifecycle phase counts (active disputes only)
  // Unknown phase counts toward chargeback (safer default — matches app behavior)
  const inquiryCount = active.filter((d) => d.phase === "inquiry").length;
  const chargebackCount = active.filter((d) => d.phase !== "inquiry").length;
  const unknownPhaseCount = active.filter(
    (d) => d.phase !== "inquiry" && d.phase !== "chargeback",
  ).length;

  // Needs-attention: needs_review or deadline within 48h
  const now = Date.now();
  const needsAttentionCount = active.filter((d) => {
    if (d.needs_review) return true;
    if (d.due_at) {
      const hoursLeft = (new Date(d.due_at).getTime() - now) / (1000 * 60 * 60);
      if (hoursLeft <= 48 && hoursLeft >= 0) return true;
    }
    return false;
  }).length;

  const won = list.filter((d) => d.status === "won");
  const lost = list.filter((d) => d.status === "lost");
  const resolved = won.length + lost.length;
  const winRate = resolved > 0 ? Math.round((won.length / resolved) * 100) : 0;

  // ── Period-over-period changes (percentage points / count diff) ──────────
  function pctChange(curr: number, prev: number | null): number | null {
    if (prev === null) return null;
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  }

  const activeDisputesChange = pctChange(activeDisputes, prevActiveCount);
  const winRateChange = prevWinRate !== null ? winRate - prevWinRate : null; // pp change
  const amountAtRiskChange = pctChange(amountAtRisk, prevAmountAtRisk);

  // ── Legacy fields (still used by chart components) ───────────────────────
  const totalDisputes = list.length;
  const revenueRecovered = won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  const revenueFormatted = revenueRecovered > 0 ? `$${revenueRecovered.toFixed(0)}` : "$0";

  const responded = list.filter((d) => d.due_at && d.created_at);
  const avgResponseMs =
    responded.length > 0
      ? responded.reduce((s, d) => {
          const due = new Date(d.due_at!).getTime();
          const created = new Date(d.created_at).getTime();
          return s + Math.max(0, due - created);
        }, 0) / responded.length
      : 0;
  const avgResponseDays = avgResponseMs / (24 * 60 * 60 * 1000);
  const avgResponseTime = avgResponseDays >= 1 ? `${avgResponseDays.toFixed(1)}d` : "<1d";

  const reasonCounts: Record<string, number> = {};
  for (const d of list) {
    const r = d.reason ?? "UNKNOWN";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const disputeCategories = Object.entries(reasonCounts)
    .map(([label, count]) => ({
      label: label.replace(/_/g, " "),
      value: totalDisputes > 0 ? Math.round((count / totalDisputes) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const rangeStart = since ?? new Date(0);
  const rangeEnd = new Date();
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
  const winRateTrend: number[] = [];
  for (let i = 0; i < 6; i++) {
    const bStart = new Date(rangeStart.getTime() + (i * rangeMs) / 6);
    const bEnd = new Date(rangeStart.getTime() + ((i + 1) * rangeMs) / 6);
    const subset = list.filter(
      (d) => new Date(d.created_at) >= bStart && new Date(d.created_at) < bEnd
    );
    const w = subset.filter((d) => d.status === "won").length;
    const l = subset.filter((d) => d.status === "lost").length;
    const r = w + l;
    winRateTrend.push(r > 0 ? Math.round((w / r) * 100) : 0);
  }

  return NextResponse.json({
    // ── Portal-matching KPIs ──
    activeDisputes,
    winRate,
    packCount: packCount ?? 0,
    amountAtRisk,
    // ── Lifecycle phase counts (active disputes only) ──
    inquiryCount,
    chargebackCount,
    unknownPhaseCount,
    needsAttentionCount,
    // ── Period-over-period changes (null when comparison not available) ──
    activeDisputesChange,
    winRateChange,
    amountAtRiskChange,
    // ── Legacy fields ──
    totalDisputes,
    revenueRecovered: revenueFormatted,
    avgResponseTime,
    winRateTrend,
    disputeCategories,
  });
}

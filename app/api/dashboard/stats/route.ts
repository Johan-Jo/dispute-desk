import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { computeDisputeMetrics } from "@/lib/disputes/metrics";

export const runtime = "nodejs";

type PeriodKey = "24h" | "7d" | "30d" | "all";

function sinceDate(period: PeriodKey): string | undefined {
  if (period === "all") return undefined;
  const ms =
    period === "24h"
      ? 24 * 60 * 60 * 1000
      : period === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

/**
 * GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all
 *
 * Returns KPIs via the shared metrics layer plus legacy chart fields.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const period = (req.nextUrl.searchParams.get("period") ?? "30d") as PeriodKey;
  const periodFrom = sinceDate(period);

  // ── Shared metrics ────────────────────────────────────────────────────
  const m = await computeDisputeMetrics({ shopId, periodFrom });

  // ── Evidence packs count ──────────────────────────────────────────────
  const sb = getServiceClient();
  const { count: packCount } = await sb
    .from("evidence_packs")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  // ── Legacy chart fields (backward compat) ─────────────────────────────
  const since = periodFrom ? new Date(periodFrom) : new Date(0);
  let legacyQuery = sb
    .from("disputes")
    .select("id, status, amount, created_at, due_at, reason")
    .eq("shop_id", shopId);
  if (periodFrom) legacyQuery = legacyQuery.gte("created_at", periodFrom);
  const { data: legacyDisputes } = await legacyQuery;
  const legacyList = legacyDisputes ?? [];

  const totalDisputes = legacyList.length;
  const revenueRecovered = m.amountRecovered > 0 ? `$${m.amountRecovered.toFixed(0)}` : "$0";

  const responded = legacyList.filter((d) => d.due_at && d.created_at);
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
  for (const d of legacyList) {
    const r = d.reason ?? "UNKNOWN";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const disputeCategories = Object.entries(reasonCounts)
    .map(([label, count]) => ({
      label,
      value: totalDisputes > 0 ? Math.round((count / totalDisputes) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const rangeEnd = new Date();
  const rangeMs = rangeEnd.getTime() - since.getTime();
  const winRateTrend: number[] = [];
  for (let i = 0; i < 6; i++) {
    const bStart = new Date(since.getTime() + (i * rangeMs) / 6);
    const bEnd = new Date(since.getTime() + ((i + 1) * rangeMs) / 6);
    const subset = legacyList.filter(
      (d) => new Date(d.created_at) >= bStart && new Date(d.created_at) < bEnd,
    );
    const w = subset.filter((d) => d.status === "won").length;
    const l = subset.filter((d) => d.status === "lost").length;
    const r = w + l;
    winRateTrend.push(r > 0 ? Math.round((w / r) * 100) : 0);
  }

  return NextResponse.json({
    // ── Shared metrics (new) ──
    ...m,
    packCount: packCount ?? 0,

    // ── Legacy fields (backward compat) ──
    totalDisputes,
    revenueRecovered,
    avgResponseTime,
    winRateTrend,
    disputeCategories,
  });
}

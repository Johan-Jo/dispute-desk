import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PeriodKey = "24h" | "7d" | "30d" | "all";

function sinceDate(period: PeriodKey): Date | null {
  if (period === "all") return null;
  const now = new Date();
  const ms = period === "24h" ? 24 * 60 * 60 * 1000
    : period === "7d" ? 7 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

/**
 * GET /api/dashboard/stats?shop_id=...&period=24h|7d|30d|all
 *
 * Returns real KPIs: totalDisputes, winRate, revenueRecovered, avgResponseTime,
 * plus winRateTrend (last 6 periods) and disputeCategories (by reason).
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const period = (req.nextUrl.searchParams.get("period") ?? "30d") as PeriodKey;
  const since = sinceDate(period);

  const sb = getServiceClient();

  let query = sb.from("disputes").select("id, status, amount, currency_code, created_at, due_at, reason").eq("shop_id", shopId);

  if (since) {
    query = query.gte("created_at", since.toISOString());
  }

  const { data: disputes, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = disputes ?? [];

  const totalDisputes = list.length;

  const won = list.filter((d) => d.status === "won");
  const lost = list.filter((d) => d.status === "lost");
  const resolved = won.length + lost.length;
  const winRate = resolved > 0 ? Math.round((won.length / resolved) * 100) : 0;

  const revenueRecovered = won.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const revenueFormatted = revenueRecovered > 0 ? `$${revenueRecovered.toFixed(0)}` : "$0";

  const responded = list.filter((d) => d.due_at && d.created_at);
  const avgResponseMs = responded.length > 0
    ? responded.reduce((sum, d) => {
        const due = new Date(d.due_at!).getTime();
        const created = new Date(d.created_at).getTime();
        return sum + Math.max(0, due - created);
      }, 0) / responded.length
    : 0;
  const avgResponseDays = avgResponseMs / (24 * 60 * 60 * 1000);
  const avgResponseTime = avgResponseDays >= 1 ? `${avgResponseDays.toFixed(1)}d` : "<1d";

  const reasonCounts: Record<string, number> = {};
  for (const d of list) {
    const r = d.reason ?? "UNKNOWN";
    reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  }
  const total = list.length;
  const disputeCategories = Object.entries(reasonCounts)
    .map(([label, count]) => ({ label: label.replace(/_/g, " "), value: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const winRateTrend: number[] = [];
  const rangeStart = since ?? new Date(0);
  const rangeEnd = new Date();
  const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
  for (let i = 0; i < 6; i++) {
    const bucketStart = new Date(rangeStart.getTime() + (i * rangeMs) / 6);
    const bucketEnd = new Date(rangeStart.getTime() + ((i + 1) * rangeMs) / 6);
    const subset = list.filter(
      (d) => new Date(d.created_at) >= bucketStart && new Date(d.created_at) < bucketEnd
    );
    const w = subset.filter((d) => d.status === "won").length;
    const l = subset.filter((d) => d.status === "lost").length;
    const r = w + l;
    winRateTrend.push(r > 0 ? Math.round((w / r) * 100) : 0);
  }

  return NextResponse.json({
    totalDisputes,
    winRate,
    revenueRecovered: revenueFormatted,
    avgResponseTime,
    winRateTrend,
    disputeCategories,
  });
}

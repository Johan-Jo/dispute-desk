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
 * Returns the full shared metrics layer plus submission state breakdown,
 * recent activity feed, and legacy chart fields.
 */
export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const period = (req.nextUrl.searchParams.get("period") ?? "30d") as PeriodKey;
  const periodFrom = sinceDate(period);

  // ── Shared metrics (period-scoped — drives Performance overview) ──────
  const m = await computeDisputeMetrics({ shopId, periodFrom });

  const sb = getServiceClient();

  // ── Operational breakdown (all-time, open disputes only) ──────────────
  // The top operational summary (Action Needed / Ready to Submit / Waiting
  // on Issuer / Closed) must reflect *current* workload, not what was
  // created during the selected period — otherwise a dispute opened 40
  // days ago and now waiting on the issuer disappears from the count.
  const { data: opRows } = await sb
    .from("disputes")
    .select("normalized_status, closed_at")
    .eq("shop_id", shopId);

  const operationalBreakdown: Record<string, number> = {};
  let operationalClosedCount = 0;
  for (const r of opRows ?? []) {
    const row = r as Record<string, unknown>;
    if (row.closed_at) {
      operationalClosedCount += 1;
      continue;
    }
    const ns = String(row.normalized_status ?? "new");
    operationalBreakdown[ns] = (operationalBreakdown[ns] ?? 0) + 1;
  }

  // ── Deadlines soon (open disputes with due_at within 3 days) ────────
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const { count: deadlinesSoonCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .is("closed_at", null)
    .not("due_at", "is", null)
    .lte("due_at", threeDaysFromNow);

  // ── Missing evidence count (open disputes without saved evidence) ────
  const { count: missingEvidenceCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .is("closed_at", null)
    .or("submission_state.is.null,submission_state.eq.not_saved");

  // ── Due today count (open disputes with due_at within 24h) ──────────
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { count: dueTodayCount } = await sb
    .from("disputes")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .is("closed_at", null)
    .not("due_at", "is", null)
    .lte("due_at", oneDayFromNow);

  // ── Submission state breakdown ────────────────────────────────────────
  const { data: subRows } = await sb
    .from("disputes")
    .select("submission_state")
    .eq("shop_id", shopId)
    .is("closed_at", null);

  const submissionBreakdown: Record<string, number> = {};
  for (const r of subRows ?? []) {
    const ss = (r as Record<string, unknown>).submission_state as string ?? "not_saved";
    submissionBreakdown[ss] = (submissionBreakdown[ss] ?? 0) + 1;
  }

  // ── Recent activity (last 10 events) ─────────────────────────────────
  const { data: activityRows } = await sb
    .from("dispute_events")
    .select("id, dispute_id, event_type, description, event_at, actor_type")
    .eq("shop_id", shopId)
    .eq("visibility", "merchant_and_internal")
    .order("event_at", { ascending: false })
    .limit(10);

  // Enrich with order name for display
  const disputeIds = [...new Set((activityRows ?? []).map((e) => (e as Record<string, unknown>).dispute_id as string))];
  const disputeNames: Record<string, string> = {};
  if (disputeIds.length > 0) {
    const { data: nameRows } = await sb
      .from("disputes")
      .select("id, order_name")
      .in("id", disputeIds);
    for (const r of nameRows ?? []) {
      const row = r as Record<string, unknown>;
      disputeNames[row.id as string] = (row.order_name as string) ?? (row.id as string).slice(0, 8).toUpperCase();
    }
  }

  const recentActivity = (activityRows ?? []).map((e) => {
    const row = e as Record<string, unknown>;
    return {
      id: row.id,
      disputeId: row.dispute_id,
      orderName: disputeNames[row.dispute_id as string] ?? (row.dispute_id as string).slice(0, 8).toUpperCase(),
      eventType: row.event_type,
      description: row.description,
      eventAt: row.event_at,
      actorType: row.actor_type,
    };
  });

  // ── Evidence packs count ──────────────────────────────────────────────
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
    .map(([label, cnt]) => ({
      label,
      count: cnt,
      value: totalDisputes > 0 ? Math.round((cnt / totalDisputes) * 100) : 0,
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

    // ── New dashboard fields ──
    operationalBreakdown,
    operationalClosedCount,
    submissionBreakdown,
    recentActivity,
    deadlinesSoonCount: deadlinesSoonCount ?? 0,
    missingEvidenceCount: missingEvidenceCount ?? 0,
    dueTodayCount: dueTodayCount ?? 0,

    // ── Legacy fields (backward compat) ──
    totalDisputes,
    revenueRecovered,
    avgResponseTime,
    winRateTrend,
    disputeCategories,
  });
}

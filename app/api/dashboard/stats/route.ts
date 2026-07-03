import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { computeDisputeMetrics } from "@/lib/disputes/metrics";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { isSpuriousDueDateEvent } from "@/lib/disputeEvents/spuriousDueDate";

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
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const period = (req.nextUrl.searchParams.get("period") ?? "30d") as PeriodKey;
  const periodFrom = sinceDate(period);

  const sb = getServiceClient();

  // Shop's Shopify presentment currency (populated at OAuth install
  // and refreshed via shop/update webhook). Used as the preferred
  // display currency for the Recovered / Lost / At Risk tiles — see
  // `MetricsOptions.preferredCurrency`.
  // Runs in parallel with the heavy disputes/events scans below; the
  // metrics call needs `preferredCurrency`, so its Promise wraps the
  // shop lookup + computeDisputeMetrics into one sequenced unit.
  const metricsP = (async () => {
    const { data: shopRow } = await sb
      .from("shops")
      .select("currency_code")
      .eq("id", shopId)
      .maybeSingle();
    const preferredCurrency =
      (shopRow?.currency_code as string | null | undefined) ?? null;
    return computeDisputeMetrics({ shopId, periodFrom, preferredCurrency });
  })();

  // ── Operational + submission breakdowns (combined scan) ──────────────
  // Both the operational summary (Action Needed / Ready to Submit /
  // Waiting on Issuer / Closed) and the submission-state breakdown
  // scan the same `disputes` table with overlapping filters. One scan
  // pulls the union of needed columns and both aggregates run client-
  // side. Closed counts must reflect *current* workload, not just the
  // selected period, so this stays unfiltered by created_at.
  const breakdownP = sb
    .from("disputes")
    .select("id, normalized_status, closed_at, submission_state")
    .eq("shop_id", shopId);

  // ── Recent activity (last 10 events) ─────────────────────────────────
  // Over-fetch then filter spurious due_date_changed rows (epoch / same-instant
  // artifacts — see lib/disputeEvents/spuriousDueDate.ts) so the feed isn't
  // flooded with "Due date changed to 1969-12-31". metadata_json is selected
  // only for that filter.
  const activityP = sb
    .from("dispute_events")
    .select("id, dispute_id, event_type, description, event_at, actor_type, metadata_json")
    .eq("shop_id", shopId)
    .eq("visibility", "merchant_and_internal")
    .order("event_at", { ascending: false })
    .limit(40);

  // ── Evidence packs count ──────────────────────────────────────────────
  const packCountP = sb
    .from("evidence_packs")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  // ── Legacy chart fields (backward compat) ─────────────────────────────
  // Only the columns the legacy computations actually use. `id`/`amount`
  // were dropped from the select — the route never reads them.
  let legacyQuery = sb
    .from("disputes")
    .select("status, created_at, due_at, reason")
    .eq("shop_id", shopId);
  if (periodFrom) legacyQuery = legacyQuery.gte("created_at", periodFrom);
  const legacyP = legacyQuery;

  const [m, breakdownRes, activityRes, packCountRes, legacyRes] =
    await Promise.all([metricsP, breakdownP, activityP, packCountP, legacyP]);

  const allDisputeRows = breakdownRes.data ?? [];
  const operationalBreakdown: Record<string, number> = {};
  const submissionBreakdown: Record<string, number> = {};
  let operationalClosedCount = 0;
  const actionNeededIds: string[] = [];
  for (const r of allDisputeRows) {
    const row = r as Record<string, unknown>;
    if (row.closed_at) {
      operationalClosedCount += 1;
      continue;
    }
    const ns = String(row.normalized_status ?? "new");
    operationalBreakdown[ns] = (operationalBreakdown[ns] ?? 0) + 1;
    if (ns === "new" || ns === "action_needed" || ns === "needs_review") {
      actionNeededIds.push(String(row.id));
    }
    const ss = (row.submission_state as string) ?? "not_saved";
    submissionBreakdown[ss] = (submissionBreakdown[ss] ?? 0) + 1;
  }
  const actionNeededDisputeId =
    actionNeededIds.length === 1 ? actionNeededIds[0] : null;

  // Drop spurious due_date_changed events (epoch / same-instant), then cap at
  // the 10 the feed shows (we over-fetched 40 to survive the filter).
  const activityRows = (activityRes.data ?? [])
    .filter(
      (e) =>
        !isSpuriousDueDateEvent(
          e as { event_type?: string | null; metadata_json?: { old_due_at?: string | null; new_due_at?: string | null } | null },
        ),
    )
    .slice(0, 10);
  // Enrich with order name for display. Depends on the activity result,
  // so runs after the Promise.all.
  const disputeIds = [...new Set(activityRows.map((e) => (e as Record<string, unknown>).dispute_id as string))];
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

  const recentActivity = activityRows.map((e) => {
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

  const packCount = packCountRes.count ?? 0;
  const since = periodFrom ? new Date(periodFrom) : new Date(0);
  const legacyList = legacyRes.data ?? [];

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

  return NextResponse.json(
    {
      // ── Shared metrics (new) ──
      ...m,
      packCount,

      // ── New dashboard fields ──
      operationalBreakdown,
      operationalClosedCount,
      actionNeededDisputeId,
      submissionBreakdown,
      recentActivity,

      // ── Legacy fields (backward compat) ──
      totalDisputes,
      revenueRecovered,
      avgResponseTime,
      winRateTrend,
      disputeCategories,
    },
    {
      headers: {
        // Short per-user cache. Dashboard staleness budget is generous —
        // a 15s fresh window with stale-while-revalidate up to 60s means
        // bounces back to /app feel instant while a manual Sync Now or
        // webhook-driven event surfaces within a minute.
        "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
      },
    },
  );
}

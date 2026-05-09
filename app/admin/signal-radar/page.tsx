import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, ListFilter } from "lucide-react";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { compareWeekOverWeek } from "@/lib/signal-radar/trends";
import {
  fetchKpiCounts,
  fetchSwitchingSignals,
  fetchCompetitorPain,
  fetchHighValueLeads,
  fetchRecentPainPoints,
} from "@/lib/signal-radar/queries";
import { categoryLabel } from "@/lib/signal-radar/category-labels";
import { SwitchingStream } from "./streams/switching-stream";
import { CompetitorPainStream } from "./streams/competitor-pain-stream";
import { HighValueStream } from "./streams/high-value-stream";
import { PainPointsStream } from "./streams/pain-points-stream";
import { WhatChangedWidget } from "./what-changed-widget";
import { ManualRefreshButton } from "./manual-refresh-button";
import { RefreshStatusBar } from "./refresh-status-bar";

export const runtime = "nodejs";
export const revalidate = 300;

export default async function SignalRadarPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const sb = getServiceClient();

  const [kpis, switching, competitor, highValue, painPoints, weekDeltasRaw] =
    await Promise.all([
      fetchKpiCounts(sb),
      fetchSwitchingSignals(sb),
      fetchCompetitorPain(sb),
      fetchHighValueLeads(sb),
      fetchRecentPainPoints(sb),
      compareWeekOverWeek(sb),
    ]);

  // Keep raw category enum for drill-through links; render plain-English label
  const weekDeltas = weekDeltasRaw.map((d) => ({
    ...d,
    rawCategory: d.category,
    category: categoryLabel(d.category),
  }));

  return (
    <div className="p-8 space-y-6">
      <AdminPageHeader
        title="Signal Radar"
        subtitle="Shopify-merchant intelligence — what's changing, what's hurting, who's switching"
        icon={Radar}
        iconGradient="from-[#0EA5E9] to-[#2563EB]"
        actions={
          <div className="flex items-center gap-2">
            <ManualRefreshButton />
            <Link
              href="/admin/signal-radar/all"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded border border-[#E2E8F0] text-[#475569] hover:bg-[#F1F5F9]"
            >
              <ListFilter className="w-3 h-3" />
              Browse all
            </Link>
          </div>
        }
      />

      <RefreshStatusBar />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="High-intent today" value={kpis.high_intent_today} accent="#2563EB" />
        <KpiCard label="Looking to switch" value={kpis.migration_today} accent="#7C3AED" />
        <KpiCard label="Reserve & payout pain" value={kpis.reserve_today} accent="#EA580C" />
        <KpiCard label="Competitor frustration" value={kpis.competitor_today} accent="#D97706" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WhatChangedWidget deltas={weekDeltas} />
        <SwitchingStream signals={switching} />
      </div>

      <PainPointsStream signals={painPoints} />

      <CompetitorPainStream rows={competitor} />

      <HighValueStream signals={highValue} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-lg bg-white border border-[#E2E8F0] p-4">
      <div className="text-[#64748B] text-xs uppercase tracking-wide font-medium">
        {label}
      </div>
      <div className="text-3xl font-bold mt-1" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

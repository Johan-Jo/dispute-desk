import { redirect } from "next/navigation";
import { Radar } from "lucide-react";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { compareWeekOverWeek } from "@/lib/signal-radar/trends";
import { extractPhrases } from "@/lib/signal-radar/cluster";
import { FeedClient, type FeedRow } from "./feed-client";
import { WhatChangedWidget } from "./what-changed-widget";
import { RecurringPhrasesWidget } from "./recurring-phrases-widget";

export const runtime = "nodejs";
export const revalidate = 300;

interface SignalRow {
  id: string;
  platform: string;
  content_type: string;
  subreddit: string | null;
  parent_external_id: string | null;
  title: string | null;
  content: string;
  url: string;
  author: string | null;
  posted_at: string;
  cluster_key: string | null;
}

interface AnalysisRow {
  source_id: string;
  merchant_relevance: boolean;
  frustration_score: number;
  emotional_intensity_score: number;
  signal_score: number;
  source_confidence_score: number;
  category: string;
  competitor: string | null;
  merchant_stage: string | null;
  merchant_type: string;
  merchant_scale_signals: string[];
  suggested_angle: string | null;
  why_this_matters: string;
  summary: string;
  cluster_size_24h: number | null;
  cluster_growth_rate: number | null;
  created_at: string;
}

const ROW_LIMIT = 200;

export default async function SignalRadarPage() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const sb = getServiceClient();
  const since14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since1d = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: analyses },
    { data: sources },
    { data: phraseSources },
    weekDeltas,
    { count: totalToday },
    { count: migrationToday },
    { count: transparencyToday },
    { count: reserveToday },
  ] = await Promise.all([
    sb
      .from("signal_analysis")
      .select(
        "source_id,merchant_relevance,frustration_score,emotional_intensity_score,signal_score,source_confidence_score,category,competitor,merchant_stage,merchant_type,merchant_scale_signals,suggested_angle,why_this_matters,summary,cluster_size_24h,cluster_growth_rate,created_at"
      )
      .gt("created_at", since14d)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT),
    sb
      .from("signal_sources")
      .select(
        "id,platform,content_type,subreddit,parent_external_id,title,content,url,author,posted_at,cluster_key"
      )
      .gt("posted_at", since14d)
      .order("posted_at", { ascending: false })
      .limit(ROW_LIMIT),
    sb
      .from("signal_sources")
      .select("title,content")
      .gt("posted_at", since7d)
      .limit(2500),
    compareWeekOverWeek(sb),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since1d)
      .gte("signal_score", 7),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since1d)
      .eq("category", "migration_intent"),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since1d)
      .eq("category", "transparency_frustration"),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .gt("created_at", since1d)
      .eq("category", "reserve_fear"),
  ]);

  const analysisBySource = new Map<string, AnalysisRow>();
  for (const a of (analyses ?? []) as AnalysisRow[]) {
    analysisBySource.set(a.source_id, a);
  }

  const rows: FeedRow[] = ((sources ?? []) as SignalRow[])
    .map((s) => {
      const a = analysisBySource.get(s.id);
      if (!a) return null;
      return {
        id: s.id,
        platform: s.platform,
        content_type: s.content_type,
        subreddit: s.subreddit,
        parent_external_id: s.parent_external_id,
        title: s.title,
        content_excerpt: s.content.slice(0, 240),
        url: s.url,
        author: s.author,
        posted_at: s.posted_at,
        cluster_key: s.cluster_key,
        merchant_relevance: a.merchant_relevance,
        frustration_score: a.frustration_score,
        emotional_intensity_score: a.emotional_intensity_score,
        signal_score: a.signal_score,
        source_confidence_score: a.source_confidence_score,
        category: a.category,
        competitor: a.competitor,
        merchant_stage: a.merchant_stage,
        merchant_type: a.merchant_type,
        merchant_scale_signals: a.merchant_scale_signals ?? [],
        suggested_angle: a.suggested_angle,
        why_this_matters: a.why_this_matters,
        summary: a.summary,
        cluster_size_24h: a.cluster_size_24h,
        cluster_growth_rate: a.cluster_growth_rate,
      };
    })
    .filter((r): r is FeedRow => r !== null);

  const phrases = extractPhrases(
    (phraseSources ?? []) as Array<{ title: string | null; content: string }>,
    25
  );

  const kpis = {
    high_intent_today: totalToday ?? 0,
    migration_today: migrationToday ?? 0,
    transparency_today: transparencyToday ?? 0,
    reserve_today: reserveToday ?? 0,
  };

  return (
    <div className="p-8 space-y-6">
      <AdminPageHeader
        title="Signal Radar"
        subtitle="Shopify-merchant intelligence — pain signals, competitor weaknesses, recurring language"
        icon={Radar}
        iconGradient="from-[#0EA5E9] to-[#2563EB]"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="High-intent today" value={kpis.high_intent_today} accent="#2563EB" />
        <KpiCard label="Migration intent today" value={kpis.migration_today} accent="#7C3AED" />
        <KpiCard label="Transparency today" value={kpis.transparency_today} accent="#DC2626" />
        <KpiCard label="Reserve fear today" value={kpis.reserve_today} accent="#EA580C" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WhatChangedWidget deltas={weekDeltas} />
        <RecurringPhrasesWidget phrases={phrases} />
      </div>

      <FeedClient rows={rows} />
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
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

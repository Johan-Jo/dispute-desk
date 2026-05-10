import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ListFilter } from "lucide-react";
import { getServiceClient } from "@/lib/supabase/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { extractPhrases } from "@/lib/signal-radar/cluster";
import { HIDDEN_CATEGORIES } from "@/lib/signal-radar/category-labels";
import { FeedClient, type FeedRow } from "../feed-client";
import { RecurringPhrasesWidget } from "../recurring-phrases-widget";

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

export default async function SignalRadarAllPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string | string[] }>;
}) {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }

  const params = (await searchParams) ?? {};
  const initialCategory = Array.isArray(params.category)
    ? params.category[0]
    : params.category;

  const sb = getServiceClient();
  // 30d window matches the ingest-loop max-age gate so re-classified items
  // (created_at recent, posted_at older) still surface in drill-through.
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: analyses }, { data: sources }, { data: phraseSources }] =
    await Promise.all([
      sb
        .from("signal_analysis")
        .select(
          "source_id,merchant_relevance,frustration_score,emotional_intensity_score,signal_score,source_confidence_score,category,competitor,merchant_stage,merchant_type,merchant_scale_signals,suggested_angle,why_this_matters,summary,cluster_size_24h,cluster_growth_rate,created_at"
        )
        .gt("created_at", since30d)
        .not("category", "in", `(${HIDDEN_CATEGORIES.map((c) => `"${c}"`).join(",")})`)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
      sb
        .from("signal_sources")
        .select(
          "id,platform,content_type,subreddit,parent_external_id,title,content,url,author,posted_at,cluster_key"
        )
        .gt("posted_at", since30d)
        .order("posted_at", { ascending: false })
        .limit(ROW_LIMIT),
      sb
        .from("signal_sources")
        .select("title,content")
        .gt("posted_at", since7d)
        .limit(2500),
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

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/signal-radar"
          className="text-[#64748B] hover:text-[#0F172A]"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Browse all signals"
          subtitle="Operator view: every classified signal in the last 30 days, filterable. For curated streams use the main page."
          icon={ListFilter}
          iconGradient="from-[#475569] to-[#64748B]"
        />
      </div>

      <RecurringPhrasesWidget phrases={phrases} />

      <FeedClient rows={rows} initialCategory={initialCategory ?? null} />
    </div>
  );
}

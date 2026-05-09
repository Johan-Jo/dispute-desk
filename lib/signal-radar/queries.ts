import type { SupabaseClient } from "@supabase/supabase-js";
import { HIDDEN_CATEGORIES } from "./category-labels";

export interface StreamSignal {
  source_id: string;
  platform: string;
  url: string;
  subreddit: string | null;
  title: string | null;
  excerpt: string;
  posted_at: string;
  author: string | null;
  category: string;
  competitor: string | null;
  merchant_type: string;
  merchant_scale_signals: string[];
  signal_score: number;
  emotional_intensity_score: number;
  source_confidence_score: number;
  frustration_score: number;
  why_this_matters: string;
  summary: string;
  suggested_angle: string | null;
}

interface JoinedSource {
  id: string;
  platform: string;
  url: string;
  subreddit: string | null;
  title: string | null;
  content: string;
  posted_at: string;
  author: string | null;
}

interface RawAnalysisRow {
  source_id: string;
  category: string;
  competitor: string | null;
  merchant_type: string;
  merchant_scale_signals: string[] | null;
  signal_score: number;
  emotional_intensity_score: number;
  source_confidence_score: number;
  frustration_score: number;
  why_this_matters: string;
  summary: string;
  suggested_angle: string | null;
  // Supabase typegen treats nested selects as arrays, even on a uniquely-keyed
  // !inner join. The array always has exactly one element here (source_id is
  // unique), so unwrap with [0] in rowToSignal.
  signal_sources: JoinedSource[] | JoinedSource | null;
}

const ANALYSIS_SELECT = `
  source_id,
  category,
  competitor,
  merchant_type,
  merchant_scale_signals,
  signal_score,
  emotional_intensity_score,
  source_confidence_score,
  frustration_score,
  why_this_matters,
  summary,
  suggested_angle,
  signal_sources!inner (
    id, platform, url, subreddit, title, content, posted_at, author
  )
`;

function rowToSignal(row: RawAnalysisRow): StreamSignal | null {
  const src = Array.isArray(row.signal_sources)
    ? row.signal_sources[0]
    : row.signal_sources;
  if (!src) return null;
  return {
    source_id: row.source_id,
    platform: src.platform,
    url: src.url,
    subreddit: src.subreddit,
    title: src.title,
    excerpt: (src.content ?? "").slice(0, 280),
    posted_at: src.posted_at,
    author: src.author,
    category: row.category,
    competitor: row.competitor,
    merchant_type: row.merchant_type,
    merchant_scale_signals: Array.isArray(row.merchant_scale_signals)
      ? row.merchant_scale_signals
      : [],
    signal_score: row.signal_score,
    emotional_intensity_score: row.emotional_intensity_score,
    source_confidence_score: row.source_confidence_score,
    frustration_score: row.frustration_score,
    why_this_matters: row.why_this_matters,
    summary: row.summary,
    suggested_angle: row.suggested_angle,
  };
}

/** Stream 1: merchants actively looking to switch tools. */
export async function fetchSwitchingSignals(
  sb: SupabaseClient
): Promise<StreamSignal[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("signal_analysis")
    .select(ANALYSIS_SELECT)
    .eq("category", "migration_intent")
    .eq("merchant_relevance", true)
    .gt("created_at", since)
    .order("signal_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(15);

  return ((data ?? []) as RawAnalysisRow[])
    .map(rowToSignal)
    .filter((r): r is StreamSignal => r !== null);
}

export interface CompetitorPainRow {
  competitor: string;
  count_7d: number;
  count_prior_7d: number;
  delta_pct: number;
  recent_signals: StreamSignal[];
}

/** Stream 2: competitor pain spikes — one row per competitor with delta. */
export async function fetchCompetitorPain(
  sb: SupabaseClient
): Promise<CompetitorPainRow[]> {
  const now = Date.now();
  const t7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const t14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recent } = await sb
    .from("signal_analysis")
    .select(ANALYSIS_SELECT)
    .not("competitor", "is", null)
    .eq("merchant_relevance", true)
    .gt("created_at", t14)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = ((recent ?? []) as RawAnalysisRow[])
    .map(rowToSignal)
    .filter((r): r is StreamSignal => r !== null);

  const byCompetitor = new Map<string, StreamSignal[]>();
  for (const r of rows) {
    if (!r.competitor) continue;
    const list = byCompetitor.get(r.competitor) ?? [];
    list.push(r);
    byCompetitor.set(r.competitor, list);
  }

  const t7ms = Date.parse(t7);
  const result: CompetitorPainRow[] = [];
  for (const [competitor, list] of byCompetitor) {
    let cur = 0;
    let prior = 0;
    for (const r of list) {
      const ts = Date.parse(r.posted_at);
      if (ts >= t7ms) cur++;
      else prior++;
    }
    const delta_pct =
      prior === 0
        ? cur > 0
          ? 100
          : 0
        : Math.round(((cur - prior) / prior) * 100);
    result.push({
      competitor,
      count_7d: cur,
      count_prior_7d: prior,
      delta_pct,
      recent_signals: list
        .sort((a, b) => b.signal_score - a.signal_score)
        .slice(0, 3),
    });
  }

  return result.sort((a, b) => b.count_7d - a.count_7d);
}

/**
 * Stream: recent pain points — surfaces high-signal items in any merchant
 * pain category, regardless of whether they hit migration_intent or named a
 * competitor. Catches transparency_frustration / reserve_fear /
 * operational_overload / support_failure / evidence_confusion items that
 * the other streams don't see.
 */
const PAIN_CATEGORIES = [
  "transparency_frustration",
  "reserve_fear",
  "operational_overload",
  "support_failure",
  "evidence_confusion",
];

export async function fetchRecentPainPoints(
  sb: SupabaseClient
): Promise<StreamSignal[]> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("signal_analysis")
    .select(ANALYSIS_SELECT)
    .in("category", PAIN_CATEGORIES)
    .eq("merchant_relevance", true)
    .gte("signal_score", 4)
    .gt("created_at", since)
    .order("signal_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(15);

  return ((data ?? []) as RawAnalysisRow[])
    .map(rowToSignal)
    .filter((r): r is StreamSignal => r !== null);
}

/** Stream 3: high-value merchant leads — has scale signals AND high signal_score. */
export async function fetchHighValueLeads(
  sb: SupabaseClient
): Promise<StreamSignal[]> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("signal_analysis")
    .select(ANALYSIS_SELECT)
    .gte("signal_score", 6)
    .eq("merchant_relevance", true)
    .neq("merchant_scale_signals", "[]")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);

  return ((data ?? []) as RawAnalysisRow[])
    .map(rowToSignal)
    .filter((r): r is StreamSignal => r !== null && r.merchant_scale_signals.length > 0)
    .slice(0, 10);
}

export interface KpiCounts {
  high_intent_today: number;
  migration_today: number;
  reserve_today: number;
  competitor_today: number;
}

/** KPI strip — counts are scoped to "today" (last 24h). */
export async function fetchKpiCounts(
  sb: SupabaseClient
): Promise<KpiCounts> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [highIntent, migration, reserve, competitor] = await Promise.all([
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .eq("merchant_relevance", true)
      .gte("signal_score", 7)
      .gt("created_at", since)
      .not("category", "in", `(${HIDDEN_CATEGORIES.map((c) => `"${c}"`).join(",")})`),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .eq("category", "migration_intent")
      .eq("merchant_relevance", true)
      .gt("created_at", since),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .eq("category", "reserve_fear")
      .eq("merchant_relevance", true)
      .gt("created_at", since),
    sb
      .from("signal_analysis")
      .select("*", { count: "exact", head: true })
      .eq("category", "competitor_frustration")
      .eq("merchant_relevance", true)
      .gt("created_at", since),
  ]);

  return {
    high_intent_today: highIntent.count ?? 0,
    migration_today: migration.count ?? 0,
    reserve_today: reserve.count ?? 0,
    competitor_today: competitor.count ?? 0,
  };
}

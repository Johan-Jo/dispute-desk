"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  MessageCircle,
  FileText,
  RefreshCw,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { DetailPanel } from "./detail-panel";

interface RefreshSnapshot {
  at: number;
  fetched_submissions: number;
  fetched_comments: number;
  inserted: number;
  errors: string[];
}

const REFRESH_KEY = "signal-radar-last-refresh";
const CLASSIFIER_INTERVAL_MS = 5 * 60 * 1000;
const CLASSIFIER_BUFFER_MS = 30 * 1000;

function loadLastRefresh(): RefreshSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(REFRESH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RefreshSnapshot>;
    if (typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > 60 * 60 * 1000) return null;
    return {
      at: parsed.at,
      fetched_submissions: parsed.fetched_submissions ?? 0,
      fetched_comments: parsed.fetched_comments ?? 0,
      inserted: parsed.inserted ?? 0,
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
    };
  } catch {
    return null;
  }
}

function saveLastRefresh(snap: RefreshSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(REFRESH_KEY, JSON.stringify(snap));
  } catch {}
}

function nextClassifierTickAt(refreshAt: number): number {
  const minutes = Math.ceil((refreshAt + CLASSIFIER_BUFFER_MS) / CLASSIFIER_INTERVAL_MS);
  return minutes * CLASSIFIER_INTERVAL_MS + CLASSIFIER_BUFFER_MS;
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export interface FeedRow {
  id: string;
  platform: string;
  content_type: string;
  subreddit: string | null;
  parent_external_id: string | null;
  title: string | null;
  content_excerpt: string;
  url: string;
  author: string | null;
  posted_at: string;
  cluster_key: string | null;
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
}

const ALL_CATEGORIES = [
  "migration_intent",
  "transparency_frustration",
  "operational_overload",
  "reserve_fear",
  "evidence_confusion",
  "support_failure",
  "competitor_frustration",
  "general_discussion",
  "spam",
  "trolling",
];

const ALL_MERCHANT_TYPES = [
  "dropshipping",
  "digital_goods",
  "subscription",
  "high_ticket_physical",
  "pod",
  "supplements",
  "unknown",
];

const TIMEFRAMES = [
  { id: "1d", label: "Today", hours: 24 },
  { id: "7d", label: "7d", hours: 7 * 24 },
  { id: "30d", label: "30d", hours: 30 * 24 },
];

interface ClusterGroup {
  lead: FeedRow;
  siblings: FeedRow[];
}

export function FeedClient({
  rows,
  initialCategory,
}: {
  rows: FeedRow[];
  initialCategory?: string | null;
}) {
  const [activeRow, setActiveRow] = useState<FeedRow | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<RefreshSnapshot | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(() =>
    initialCategory ? new Set([initialCategory]) : new Set()
  );
  // When a user drills in from the What Changed widget, the matching items
  // may have an older posted_at (from when the post was created on Reddit /
  // Shopify Community / etc.) than their classification created_at. Default
  // the timeframe to 30d so drilled-through views aren't accidentally empty.
  const initialTimeframe = initialCategory ? "30d" : "7d";
  const [merchantTypeFilter, setMerchantTypeFilter] = useState<Set<string>>(new Set());
  const [minSignal, setMinSignal] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  const [minEmotion, setMinEmotion] = useState(0);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [sort, setSort] = useState<"quality" | "recent" | "emotion">("quality");

  useEffect(() => {
    setLastRefresh(loadLastRefresh());
  }, []);

  useEffect(() => {
    if (!lastRefresh) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastRefresh]);

  const filtered = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.id === timeframe) ?? TIMEFRAMES[1];
    const cutoff = Date.now() - tf.hours * 60 * 60 * 1000;
    return rows.filter((r) => {
      if (new Date(r.posted_at).getTime() < cutoff) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(r.category)) return false;
      if (merchantTypeFilter.size > 0 && !merchantTypeFilter.has(r.merchant_type)) return false;
      if (r.signal_score < minSignal) return false;
      if (r.source_confidence_score < minConfidence) return false;
      if (r.emotional_intensity_score < minEmotion) return false;
      return true;
    });
  }, [rows, categoryFilter, merchantTypeFilter, minSignal, minConfidence, minEmotion, timeframe]);

  const grouped = useMemo<ClusterGroup[]>(() => {
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "recent") {
        return new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime();
      }
      if (sort === "emotion") {
        if (b.emotional_intensity_score !== a.emotional_intensity_score) {
          return b.emotional_intensity_score - a.emotional_intensity_score;
        }
        return new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime();
      }
      if (b.source_confidence_score !== a.source_confidence_score) {
        return b.source_confidence_score - a.source_confidence_score;
      }
      if (b.signal_score !== a.signal_score) return b.signal_score - a.signal_score;
      return new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime();
    });

    const groups = new Map<string, ClusterGroup>();
    const singletons: ClusterGroup[] = [];

    for (const row of sorted) {
      if (!row.cluster_key) {
        singletons.push({ lead: row, siblings: [] });
        continue;
      }
      const existing = groups.get(row.cluster_key);
      if (!existing) {
        groups.set(row.cluster_key, { lead: row, siblings: [] });
      } else {
        existing.siblings.push(row);
      }
    }

    return [...groups.values(), ...singletons].sort((a, b) => {
      if (sort === "recent") {
        return new Date(b.lead.posted_at).getTime() - new Date(a.lead.posted_at).getTime();
      }
      return b.lead.signal_score - a.lead.signal_score;
    });
  }, [filtered, sort]);

  const visibleGroups = grouped.slice(0, 100);

  function toggleSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function manualRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/admin/signal-radar/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "reddit" }),
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        // Server returned HTML or plain text (Vercel timeout / edge error)
        const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
        setRefreshError(
          res.status === 504 || /timeout/i.test(snippet)
            ? `Request timed out (Vercel ${res.status}). Apify scrape exceeded the function timeout — try again or lower APIFY_REDDIT_ACTOR_ID maxItems.`
            : `Server returned non-JSON response (${res.status}): ${snippet}`
        );
        return;
      }
      if (!res.ok) {
        setRefreshError(
          (json as { error?: string }).error ??
            res.statusText ??
            "request failed"
        );
        return;
      }
      const j = json as {
        fetched_submissions?: number;
        fetched_comments?: number;
        inserted?: number;
        errors?: string[];
      };
      const snap: RefreshSnapshot = {
        at: Date.now(),
        fetched_submissions: j.fetched_submissions ?? 0,
        fetched_comments: j.fetched_comments ?? 0,
        inserted: j.inserted ?? 0,
        errors: Array.isArray(j.errors) ? j.errors : [],
      };
      saveLastRefresh(snap);
      setLastRefresh(snap);
      setNow(Date.now());
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "request failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white border border-[#E2E8F0] p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 text-xs">
            <span className="text-[#64748B] mr-1">Time:</span>
            {TIMEFRAMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTimeframe(t.id)}
                className={`px-2 py-1 rounded ${
                  timeframe === t.id
                    ? "bg-[#2563EB] text-white"
                    : "bg-[#F1F5F9] text-[#475569]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 text-xs">
            <span className="text-[#64748B] mr-1">Sort:</span>
            {(["quality", "recent", "emotion"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2 py-1 rounded ${
                  sort === s ? "bg-[#2563EB] text-white" : "bg-[#F1F5F9] text-[#475569]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {refreshError && (
              <span className="text-xs text-[#DC2626]">Error: {refreshError}</span>
            )}
            <button
              onClick={manualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          </div>
        </div>

        {lastRefresh && (
          <RefreshStatusBanner snap={lastRefresh} now={now} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <SliderRow label="Min signal" value={minSignal} onChange={setMinSignal} />
          <SliderRow label="Min confidence" value={minConfidence} onChange={setMinConfidence} />
          <SliderRow label="Min emotion" value={minEmotion} onChange={setMinEmotion} />
        </div>

        <ChipGroup
          label="Category"
          values={ALL_CATEGORIES}
          active={categoryFilter}
          onToggle={(v) => setCategoryFilter(toggleSet(categoryFilter, v))}
        />
        <ChipGroup
          label="Merchant type"
          values={ALL_MERCHANT_TYPES}
          active={merchantTypeFilter}
          onToggle={(v) => setMerchantTypeFilter(toggleSet(merchantTypeFilter, v))}
        />
      </div>

      <div className="rounded-lg bg-white border border-[#E2E8F0] overflow-hidden">
        {visibleGroups.length === 0 ? (
          <EmptyState lastRefresh={lastRefresh} now={now} />
        ) : (
          <ul className="divide-y divide-[#E2E8F0]">
            {visibleGroups.map((group) => (
              <FeedRowItem
                key={group.lead.id}
                group={group}
                expanded={expandedClusters.has(group.lead.cluster_key ?? "")}
                onExpand={() => {
                  if (!group.lead.cluster_key) return;
                  setExpandedClusters((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.lead.cluster_key!)) {
                      next.delete(group.lead.cluster_key!);
                    } else {
                      next.add(group.lead.cluster_key!);
                    }
                    return next;
                  });
                }}
                onSelect={(row) => setActiveRow(row)}
              />
            ))}
          </ul>
        )}
      </div>

      <DetailPanel row={activeRow} onClose={() => setActiveRow(null)} />
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[#64748B] w-28">{label}</span>
      <input
        type="range"
        min={0}
        max={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-medium w-6 text-right">{value}</span>
    </div>
  );
}

function ChipGroup({
  label,
  values,
  active,
  onToggle,
}: {
  label: string;
  values: string[];
  active: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-xs text-[#64748B] mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className={`px-2 py-0.5 rounded text-xs ${
              active.has(v)
                ? "bg-[#2563EB] text-white"
                : "bg-[#F1F5F9] text-[#475569]"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedRowItem({
  group,
  expanded,
  onExpand,
  onSelect,
}: {
  group: ClusterGroup;
  expanded: boolean;
  onExpand: () => void;
  onSelect: (row: FeedRow) => void;
}) {
  const lead = group.lead;
  const Icon = lead.content_type === "comment" ? MessageCircle : FileText;
  const clusterCount = group.siblings.length + 1;
  return (
    <li>
      <button
        onClick={() => onSelect(lead)}
        className="w-full text-left p-4 hover:bg-[#F8FAFC] transition-colors"
      >
        <div className="flex items-start gap-3">
          <Icon className="w-4 h-4 mt-0.5 text-[#94A3B8] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <CategoryBadge category={lead.category} />
              <MerchantTypeBadge type={lead.merchant_type} />
              {lead.competitor && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">
                  {lead.competitor}
                </span>
              )}
              {clusterCount > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpand();
                  }}
                  className="text-xs px-1.5 py-0.5 rounded bg-[#EDE9FE] text-[#6D28D9] hover:bg-[#DDD6FE]"
                >
                  +{group.siblings.length} similar
                </button>
              )}
              <span className="ml-auto text-xs text-[#94A3B8]">
                {relativeTime(lead.posted_at)}
              </span>
            </div>
            <div className="font-medium text-[#0F172A] mb-1 truncate">
              {lead.title ?? lead.content_excerpt.slice(0, 80)}
            </div>
            {lead.content_type === "comment" && (
              <div className="text-xs text-[#64748B] mb-1 truncate">
                comment in {lead.subreddit}
              </div>
            )}
            <div className="text-sm text-[#475569] line-clamp-1">{lead.summary}</div>
            <div className="flex items-center gap-3 mt-2 text-xs text-[#64748B]">
              <span>signal {lead.signal_score}</span>
              <span>emotion {lead.emotional_intensity_score}</span>
              <span>conf {lead.source_confidence_score}</span>
              <span>frustration {lead.frustration_score}</span>
              {lead.subreddit && <span>{lead.subreddit}</span>}
              <a
                href={lead.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-auto inline-flex items-center gap-1 text-[#2563EB] hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                source
              </a>
            </div>
          </div>
        </div>
      </button>
      {expanded && group.siblings.length > 0 && (
        <ul className="bg-[#F8FAFC] divide-y divide-[#E2E8F0]">
          {group.siblings.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s)}
                className="w-full text-left p-3 pl-12 text-sm hover:bg-[#F1F5F9]"
              >
                <div className="text-[#0F172A] truncate">
                  {s.title ?? s.content_excerpt.slice(0, 80)}
                </div>
                <div className="text-xs text-[#64748B] mt-0.5">
                  signal {s.signal_score} · emotion {s.emotional_intensity_score} · {relativeTime(s.posted_at)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const accent = CATEGORY_ACCENTS[category] ?? "#475569";
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: `${accent}20`, color: accent }}
    >
      {category}
    </span>
  );
}

function MerchantTypeBadge({ type }: { type: string }) {
  if (type === "unknown") return null;
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#475569]">
      {type}
    </span>
  );
}

const CATEGORY_ACCENTS: Record<string, string> = {
  migration_intent: "#7C3AED",
  transparency_frustration: "#DC2626",
  reserve_fear: "#EA580C",
  competitor_frustration: "#D97706",
  evidence_confusion: "#2563EB",
  operational_overload: "#0891B2",
  support_failure: "#0EA5E9",
};

function RefreshStatusBanner({
  snap,
  now,
}: {
  snap: RefreshSnapshot;
  now: number;
}) {
  const elapsed = now - snap.at;
  const tickAt = nextClassifierTickAt(snap.at);
  const remaining = tickAt - now;
  const tickReady = remaining <= 0;
  const errors = snap.errors ?? [];
  const hasErrors = errors.length > 0;

  return (
    <div className="space-y-2">
      <div
        className={`rounded-md border px-3 py-2 text-xs flex items-center gap-3 ${
          hasErrors
            ? "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]"
            : tickReady
              ? "bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]"
              : "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]"
        }`}
      >
        {hasErrors ? (
          <Clock className="w-4 h-4 flex-shrink-0" />
        ) : tickReady ? (
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        ) : (
          <Clock className="w-4 h-4 flex-shrink-0" />
        )}
        <div className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Refreshed <strong>{formatDuration(elapsed)}</strong> ago
          </span>
          <span className="opacity-70">·</span>
          <span>
            ingested <strong>{snap.fetched_submissions}</strong> posts +{" "}
            <strong>{snap.fetched_comments}</strong> comments (
            <strong>{snap.inserted}</strong> new)
          </span>
          {!hasErrors && (
            <>
              <span className="opacity-70">·</span>
              {tickReady ? (
                <span>
                  classifier should have run — <strong>reload</strong> to see
                  results
                </span>
              ) : (
                <span>
                  next classifier tick in <strong>{formatDuration(remaining)}</strong>
                </span>
              )}
            </>
          )}
        </div>
        {tickReady && !hasErrors && (
          <button
            onClick={() => window.location.reload()}
            className="px-2 py-1 rounded bg-[#10B981] text-white font-medium hover:bg-[#059669]"
          >
            Reload
          </button>
        )}
      </div>
      {hasErrors && (
        <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
          <div className="font-semibold mb-1">Ingest errors ({errors.length}):</div>
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((e, i) => (
              <li key={i} className="break-all">{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  lastRefresh,
  now,
}: {
  lastRefresh: RefreshSnapshot | null;
  now: number;
}) {
  if (!lastRefresh) {
    return (
      <div className="p-12 text-center text-[#64748B] text-sm">
        No signals yet. The hourly Reddit ingest cron will populate this feed
        automatically — or click <strong>Refresh now</strong> above to seed initial data.
      </div>
    );
  }

  const tickAt = nextClassifierTickAt(lastRefresh.at);
  const remaining = tickAt - now;
  const tickReady = remaining <= 0;

  if (lastRefresh.inserted === 0) {
    return (
      <div className="p-12 text-center text-[#64748B] text-sm space-y-1">
        <div>
          The last refresh fetched <strong>{lastRefresh.fetched_submissions}</strong> posts +{" "}
          <strong>{lastRefresh.fetched_comments}</strong> comments but{" "}
          <strong>0 were new</strong> — Reddit returned items already in the database.
        </div>
        <div className="text-xs opacity-80">
          Wait for the next hourly cron to pick up fresh posts, or come back later.
        </div>
      </div>
    );
  }

  if (!tickReady) {
    return (
      <div className="p-12 text-center text-[#64748B] text-sm space-y-1">
        <div>
          Just ingested <strong>{lastRefresh.inserted}</strong> new items.
        </div>
        <div>
          The classifier runs every 5 minutes — first results in roughly{" "}
          <strong>{formatDuration(remaining)}</strong>.
        </div>
        <div className="text-xs opacity-80 mt-2">
          The page will offer a reload button once the classifier has run.
        </div>
      </div>
    );
  }

  return (
    <div className="p-12 text-center text-[#64748B] text-sm space-y-2">
      <div>The classifier has had time to run.</div>
      <div className="text-xs">
        If the feed is still empty, check Vercel logs for{" "}
        <code className="px-1 bg-[#F1F5F9] rounded">/api/cron/signal-radar-classify</code>{" "}
        — the most common cause is a missing or invalid <code>OPENAI_API_KEY</code>.
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-[#10B981] text-white hover:bg-[#059669]"
      >
        <RefreshCw className="w-3 h-3" />
        Reload now
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

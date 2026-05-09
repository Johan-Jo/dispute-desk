"use client";

import { useMemo, useState } from "react";
import { ExternalLink, MessageCircle, FileText, RefreshCw } from "lucide-react";
import { DetailPanel } from "./detail-panel";

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

export function FeedClient({ rows }: { rows: FeedRow[] }) {
  const [activeRow, setActiveRow] = useState<FeedRow | null>(null);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [merchantTypeFilter, setMerchantTypeFilter] = useState<Set<string>>(new Set());
  const [minSignal, setMinSignal] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  const [minEmotion, setMinEmotion] = useState(0);
  const [timeframe, setTimeframe] = useState("7d");
  const [sort, setSort] = useState<"quality" | "recent" | "emotion">("quality");

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
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/admin/signal-radar/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "reddit" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRefreshMsg(`Error: ${json.error ?? res.statusText}`);
      } else {
        setRefreshMsg(
          `Fetched ${json.fetched_submissions ?? 0} posts + ${json.fetched_comments ?? 0} comments · ${json.inserted ?? 0} new`
        );
        setTimeout(() => window.location.reload(), 1200);
      }
    } catch (e) {
      setRefreshMsg(`Error: ${e instanceof Error ? e.message : "request failed"}`);
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
            {refreshMsg && (
              <span className="text-xs text-[#64748B]">{refreshMsg}</span>
            )}
            <button
              onClick={manualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              Refresh now
            </button>
          </div>
        </div>

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
          <div className="p-12 text-center text-[#64748B] text-sm">
            No signals yet. Cron runs hourly — or click <strong>Refresh now</strong> above to seed
            initial data. (You may need at least one classified item before the feed populates.)
          </div>
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

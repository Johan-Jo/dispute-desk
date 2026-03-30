"use client";

import { useState, useMemo, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Filter,
  Plus,
  X,
  Lightbulb,
  InboxIcon,
  FileCheck,
  AlertTriangle,
  Sparkles,
  Loader2,
  HelpCircle,
  GripVertical,
} from "lucide-react";
import { useToast } from "@/components/admin/Toast";
import { ArchiveItemStatusBadge, PriorityBadge } from "@/components/admin/resources";
import { RESOURCE_HUB_PILLARS } from "@/lib/resources/pillars";
import type { ContentType, Priority } from "@/lib/resources/workflow";
import { CONTENT_TYPES, getContentTypeLabel } from "@/lib/resources/workflow";

interface BacklogItem {
  id: string;
  proposed_title: string;
  target_keyword: string | null;
  search_intent: string | null;
  primary_pillar?: string | null;
  summary?: string | null;
  priority_score: number;
  backlog_rank?: number;
  status: string;
  content_type: string | null;
  notes: string | null;
  [key: string]: unknown;
}

/** Generic one-liner from `scripts/seed-resources-hub.mjs` — hide as “real” brief text in UI. */
const SEED_SUMMARY_SNIPPET = "seed backlog entry for editorial prioritization";

function titleCasePhrase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function isGenericArchiveTitle(title: string | undefined): boolean {
  if (!title?.trim()) return false;
  return /^archive idea\s+\d+:/i.test(title.trim());
}

function meaningfulBacklogSummary(item: BacklogItem): string | null {
  const s = typeof item.summary === "string" ? item.summary.trim() : "";
  if (s.length < 20) return null;
  if (s.toLowerCase().includes(SEED_SUMMARY_SNIPPET)) return null;
  return s;
}

/** Reader-facing headline when the stored title is a placeholder. */
function backlogHeadline(item: BacklogItem): string {
  const kw = item.target_keyword?.trim();
  if (kw) return titleCasePhrase(kw);
  return item.proposed_title?.trim() || "Untitled idea";
}

function backlogMetaLine(item: BacklogItem): string {
  const parts: string[] = [];
  if (item.content_type) parts.push(item.content_type.replace(/_/g, " "));
  if (item.search_intent) parts.push(`${item.search_intent} intent`);
  if (item.primary_pillar) parts.push(item.primary_pillar.replace(/-/g, " "));
  return parts.join(" · ");
}

/** Brief / summary text for the dedicated column (falls back to substantive notes). */
function backlogBriefColumnText(item: BacklogItem): string | null {
  const brief = meaningfulBacklogSummary(item);
  if (brief) return brief;
  const n = typeof item.notes === "string" ? item.notes.trim() : "";
  if (n.length >= 20) return n;
  return null;
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) {
    return arr;
  }
  const next = [...arr];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

interface BacklogClientProps {
  initialItems: BacklogItem[];
}

const PRIORITY_TIERS = [
  { label: "All", value: "all" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
];

const STATUS_FILTERS = [
  { label: "All", value: "all" },
  { label: "Idea", value: "idea" },
  { label: "Backlog", value: "backlog" },
  { label: "Brief Ready", value: "brief_ready" },
];

function scoreToPriority(score: number): Priority {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function BacklogClient({ initialItems }: BacklogClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<BacklogItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addKeyword, setAddKeyword] = useState("");
  const [addPillar, setAddPillar] = useState<(typeof RESOURCE_HUB_PILLARS)[number]>("chargebacks");
  const [addType, setAddType] = useState<ContentType>("cluster_article");
  const [addSummary, setAddSummary] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [clearingBacklog, setClearingBacklog] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const { toast } = useToast();

  function openAddIdea() {
    setAddTitle("");
    setAddKeyword("");
    setAddPillar("chargebacks");
    setAddType("cluster_article");
    setAddSummary("");
    setAddOpen(true);
  }

  async function submitAddIdea(e: FormEvent) {
    e.preventDefault();
    const title = addTitle.trim();
    if (!title) {
      toast("error", "Enter a title for the idea.");
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await fetch("/api/admin/resources/archive-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposed_title: title,
          target_keyword: addKeyword.trim() || null,
          primary_pillar: addPillar,
          content_type: addType,
          search_intent: "informational",
          summary: addSummary.trim() || null,
          status: "idea",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        item?: BacklogItem;
      };
      if (!res.ok) {
        toast("error", data.error ?? "Could not create idea");
        return;
      }
      if (data.item) {
        setItems((prev) => [data.item as BacklogItem, ...prev]);
      }
      toast("success", "Idea added to the pipeline.");
      setAddOpen(false);
      router.refresh();
    } catch {
      toast("error", "Network error while saving");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleGenerate(itemId: string) {
    setGeneratingId(itemId);
    try {
      const res = await fetch("/api/admin/resources/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archiveItemId: itemId }),
      });
      const data = await res.json();
      if (res.ok && data.contentItemId) {
        toast("success", `Draft generated! Redirecting to editor...`);
        window.location.href = `/admin/resources/content/${data.contentItemId}`;
      } else {
        toast("error", data.error ?? "Generation failed");
      }
    } catch {
      toast("error", "Network error during generation");
    } finally {
      setGeneratingId(null);
    }
  }

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) => {
        const summary = typeof i.summary === "string" ? i.summary.toLowerCase() : "";
        const pillar = typeof i.primary_pillar === "string" ? i.primary_pillar.toLowerCase() : "";
        return (
          i.proposed_title?.toLowerCase().includes(q) ||
          i.target_keyword?.toLowerCase().includes(q) ||
          i.notes?.toLowerCase().includes(q) ||
          summary.includes(q) ||
          pillar.includes(q)
        );
      });
    }
    if (priorityFilter !== "all") {
      list = list.filter((i) => scoreToPriority(i.priority_score) === priorityFilter);
    }
    if (statusFilter !== "all") {
      list = list.filter((i) => i.status === statusFilter);
    }
    return list;
  }, [items, search, priorityFilter, statusFilter]);

  const stats = useMemo(() => {
    const all = items;
    return {
      ideas: all.filter((i) => i.status === "idea").length,
      backlog: all.filter((i) => i.status === "backlog").length,
      briefReady: all.filter((i) => i.status === "brief_ready").length,
      highPriority: all.filter((i) => i.priority_score >= 70).length,
    };
  }, [items]);

  const hasActiveFilters = priorityFilter !== "all" || statusFilter !== "all";
  const canDragReorder =
    !search.trim() && priorityFilter === "all" && statusFilter === "all" && items.length > 1;

  async function persistReorder(ordered: BacklogItem[]) {
    setReorderSaving(true);
    try {
      const res = await fetch("/api/admin/resources/archive-items/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: ordered.map((i) => i.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast("error", data.error ?? "Could not save order");
        router.refresh();
        return;
      }
      toast("success", "Queue order saved");
    } catch {
      toast("error", "Network error while saving order");
      router.refresh();
    } finally {
      setReorderSaving(false);
    }
  }

  function handleDropRow(targetId: string) {
    if (!canDragReorder || !draggingId || draggingId === targetId) return;
    const from = items.findIndex((i) => i.id === draggingId);
    const to = items.findIndex((i) => i.id === targetId);
    if (from === -1 || to === -1) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    void persistReorder(next);
    setDraggingId(null);
  }

  async function clearBacklog() {
    const ok = window.confirm(
      "Remove every backlog, idea, and brief-ready row? Converted items (already turned into drafts) are kept. This cannot be undone.",
    );
    if (!ok) return;
    setClearingBacklog(true);
    try {
      const res = await fetch("/api/admin/resources/archive-items", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
      if (!res.ok) {
        toast("error", data.error ?? "Could not clear backlog");
        return;
      }
      setItems([]);
      toast("success", `Removed ${data.deleted ?? 0} items`);
      router.refresh();
    } catch {
      toast("error", "Network error while clearing backlog");
    } finally {
      setClearingBacklog(false);
    }
  }

  const readyCount = filtered.filter((i) => i.status === "brief_ready").length;

  const kpis = [
    { label: "Ideas", value: stats.ideas, icon: Lightbulb, iconColor: "text-[#F59E0B]", iconBg: "bg-[#FEF3C7]" },
    { label: "In Backlog", value: stats.backlog, icon: InboxIcon, iconColor: "text-[#3B82F6]", iconBg: "bg-[#EFF6FF]" },
    { label: "Brief Ready", value: stats.briefReady, icon: FileCheck, iconColor: "text-[#22C55E]", iconBg: "bg-[#F0FDF4]" },
    { label: "High Priority", value: stats.highPriority, icon: AlertTriangle, iconColor: "text-[#EF4444]", iconBg: "bg-[#FEF2F2]" },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Content Backlog</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Editorial planning and content ideas pipeline
          </p>
          <Link
            href="/admin/help#help-ai-generator"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1D4ED8] hover:underline mt-2"
          >
            <HelpCircle className="w-4 h-4 shrink-0" aria-hidden />
            How AI generation works
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            href="/admin/resources/list"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
          >
            View Published
          </Link>
          <button
            type="button"
            disabled={clearingBacklog || items.length === 0}
            onClick={() => void clearBacklog()}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-red-200 text-red-800 bg-white hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {clearingBacklog ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            ) : null}
            Clear backlog
          </button>
          <button
            type="button"
            onClick={openAddIdea}
            className="inline-flex items-center gap-2 bg-[#1D4ED8] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#1E40AF] transition-colors"
          >
            <Plus className="w-4 h-4 shrink-0" aria-hidden />
            Add Idea
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="bg-white rounded-xl border border-[#E5E7EB] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[#64748B]">{kpi.label}</span>
                <div className={`w-9 h-9 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${kpi.iconColor}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-[#0B1220]">{kpi.value}</p>
            </div>
          );
        })}
      </div>

      {/* Search + Filters */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] mb-4">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input
              type="text"
              placeholder="Search by title or keyword..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              showFilters || hasActiveFilters
                ? "border-[#1D4ED8] text-[#1D4ED8] bg-[#EFF6FF]"
                : "border-[#E5E7EB] text-[#64748B] hover:bg-[#F8FAFC]"
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>
        {!canDragReorder && items.length > 1 && (search.trim() || hasActiveFilters) ? (
          <div className="px-4 py-2 border-t border-[#E5E7EB] bg-[#FAFBFC]">
            <p className="text-xs text-[#64748B]">
              Clear search and filters to reorder the queue by dragging the grip handle.
            </p>
          </div>
        ) : null}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-t border-[#E5E7EB] bg-[#F8FAFC]">
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1">Priority</label>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="text-sm border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              >
                {PRIORITY_TIERS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#64748B] mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
              >
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            {hasActiveFilters && (
              <button
                onClick={() => { setPriorityFilter("all"); setStatusFilter("all"); }}
                className="inline-flex items-center gap-1 text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium mt-4"
              >
                <X className="w-3.5 h-3.5" /> Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#64748B] uppercase tracking-wider border-b border-[#E5E7EB] bg-[#F8FAFC]">
                <th className="px-4 py-3 font-medium w-20">#</th>
                <th className="px-4 py-3 font-medium min-w-[200px]">Topic</th>
                <th className="px-4 py-3 font-medium min-w-[220px]">Brief</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Keyword</th>
                <th className="px-4 py-3 font-medium">Intent</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#64748B]">
                    No backlog items found
                  </td>
                </tr>
              )}
              {filtered.map((item, idx) => {
                const meta = backlogMetaLine(item);
                const briefCol = backlogBriefColumnText(item);
                return (
                <tr
                  key={item.id}
                  className={`hover:bg-[#F6F8FB] transition-colors group ${
                    draggingId === item.id ? "opacity-60" : ""
                  }`}
                  onDragOver={
                    canDragReorder
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }
                      : undefined
                  }
                  onDrop={
                    canDragReorder
                      ? (e) => {
                          e.preventDefault();
                          handleDropRow(item.id);
                        }
                      : undefined
                  }
                >
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-1.5">
                      <span
                        draggable={canDragReorder}
                        role={canDragReorder ? "button" : undefined}
                        tabIndex={canDragReorder ? 0 : undefined}
                        aria-label={canDragReorder ? "Drag to reorder queue" : "Reorder disabled while filtering"}
                        title={canDragReorder ? "Drag to reorder" : "Clear filters to reorder"}
                        onDragStart={
                          canDragReorder
                            ? (e) => {
                                setDraggingId(item.id);
                                e.dataTransfer.setData("text/plain", item.id);
                                e.dataTransfer.effectAllowed = "move";
                              }
                            : undefined
                        }
                        onDragEnd={() => setDraggingId(null)}
                        className={`shrink-0 rounded p-0.5 touch-none ${
                          canDragReorder
                            ? "cursor-grab active:cursor-grabbing text-[#94A3B8] hover:text-[#64748B] hover:bg-[#E5E7EB]"                            : "cursor-not-allowed text-[#CBD5E1]"
                        }`}
                      >
                        <GripVertical className="w-4 h-4" aria-hidden />
                      </span>
                      <span className="text-xs text-[#64748B] w-5 text-right tabular-nums">{idx + 1}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-md align-top">
                    <p className="font-medium text-[#0B1220] leading-snug">
                      {backlogHeadline(item)}
                    </p>
                    {meta && (
                      <p className="text-xs text-[#64748B] mt-1">
                        {meta}
                      </p>
                    )}
                    {isGenericArchiveTitle(item.proposed_title) && (
                      <p
                        className="text-[10px] text-[#94A3B8] mt-1.5 font-mono truncate"
                        title={item.proposed_title}
                      >
                        Row label: {item.proposed_title}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[280px] align-top">
                    {briefCol ? (
                      <p
                        className="text-xs text-[#475569] line-clamp-4 leading-relaxed"
                        title={briefCol}
                      >
                        {briefCol}
                      </p>
                    ) : (
                      <span className="text-[#64748B]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#64748B]">
                    {item.content_type ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {item.target_keyword ? (
                      <code className="text-xs bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">
                        {item.target_keyword}
                      </code>
                    ) : (
                      <span className="text-[#64748B]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#64748B] capitalize">
                    {item.search_intent ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={scoreToPriority(item.priority_score)} />
                  </td>
                  <td className="px-4 py-3">
                    <ArchiveItemStatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleGenerate(item.id)}
                        disabled={!!generatingId}
                        className="inline-flex items-center gap-1 text-sm text-[#8B5CF6] hover:text-[#7C3AED] font-medium whitespace-nowrap disabled:opacity-50"
                      >
                        {generatingId === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        Generate
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-[#E5E7EB] text-sm text-[#64748B]">
          <span>Showing {filtered.length} of {items.length} items</span>
          <div className="flex items-center gap-3">
            {reorderSaving ? (
              <span className="inline-flex items-center gap-1.5 text-[#3B82F6]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                Saving order…
              </span>
            ) : null}
            {readyCount > 0 ? (
              <span className="text-[#22C55E] font-medium">{readyCount} ready to start</span>
            ) : null}
          </div>
        </div>
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            role="presentation"
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!addSubmitting) setAddOpen(false);
            }}
          />
          <form
            className="relative z-10 w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-lg"
            onSubmit={submitAddIdea}
            aria-labelledby="add-idea-heading"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 id="add-idea-heading" className="text-lg font-semibold text-[#0B1220]">
                  Add idea
                </h2>
                <p className="text-sm text-[#64748B] mt-0.5">
                  Creates a new pipeline row (status: Idea). Target locales match your hub languages.
                </p>
              </div>
              <button
                type="button"
                disabled={addSubmitting}
                onClick={() => setAddOpen(false)}
                className="p-1 rounded-lg text-[#64748B] hover:bg-[#F1F5F9] disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="add-idea-title-input" className="block text-xs font-medium text-[#64748B] mb-1">
                  Title <span className="text-red-600">*</span>
                </label>
                <input
                  id="add-idea-title-input"
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/25"
                  placeholder="e.g. Merchant guide to Visa chargeback reason codes"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label htmlFor="add-idea-keyword" className="block text-xs font-medium text-[#64748B] mb-1">
                  Target keyword
                </label>
                <input
                  id="add-idea-keyword"
                  value={addKeyword}
                  onChange={(e) => setAddKeyword(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/25 font-mono"
                  placeholder="Optional — e.g. visa chargeback evidence"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="add-idea-pillar" className="block text-xs font-medium text-[#64748B] mb-1">
                    Pillar
                  </label>
                  <select
                    id="add-idea-pillar"
                    value={addPillar}
                    onChange={(e) =>
                      setAddPillar(e.target.value as (typeof RESOURCE_HUB_PILLARS)[number])
                    }
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/25"
                  >
                    {RESOURCE_HUB_PILLARS.map((p) => (
                      <option key={p} value={p}>
                        {p.replace(/-/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="add-idea-type" className="block text-xs font-medium text-[#64748B] mb-1">
                    Type
                  </label>
                  <select
                    id="add-idea-type"
                    value={addType}
                    onChange={(e) => setAddType(e.target.value as ContentType)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/25"
                  >
                    {CONTENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {getContentTypeLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="add-idea-summary" className="block text-xs font-medium text-[#64748B] mb-1">
                  Brief / summary
                </label>
                <textarea
                  id="add-idea-summary"
                  value={addSummary}
                  onChange={(e) => setAddSummary(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/25 resize-y min-h-[4.5rem]"
                  placeholder="What should this piece cover? Who is it for?"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                disabled={addSubmitting}
                onClick={() => setAddOpen(false)}
                className="px-4 py-2 text-sm font-medium text-[#64748B] hover:text-[#0B1220] rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1D4ED8] rounded-lg hover:bg-[#1E40AF] disabled:opacity-50"
              >
                {addSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
                ) : (
                  <Plus className="w-4 h-4 shrink-0" aria-hidden />
                )}
                Save idea
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

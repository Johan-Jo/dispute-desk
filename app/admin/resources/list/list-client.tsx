"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ListTodo,
  ChevronLeft,
  ChevronRight,
  Pencil,
  MoreHorizontal,
  X,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  WorkflowStatusBadge,
  ContentTypeBadge,
  LocaleStatusIndicator,
} from "@/components/admin/resources";
import type { ContentType, WorkflowStatus } from "@/lib/resources/workflow";
import {
  ADMIN_LOCALES,
  CONTENT_TYPES,
  getContentTypeLabel,
} from "@/lib/resources/workflow";

/** Default list filter: article language `source_locale` (matches server SSR). */
const DEFAULT_LIST_LOCALE = "en-US";

/* ── Types ─────────────────────────────────────────────────────────── */

interface ContentRow {
  id: string;
  /** Editorial authoring language (`content_items.source_locale`). */
  source_locale?: string | null;
  content_type: string;
  primary_pillar: string;
  topic: string | null;
  workflow_status: string;
  priority: string;
  updated_at: string;
  published_at: string | null;
  authors: Array<{ name: string }> | { name: string } | null;
  reviewers: Array<{ name: string }> | { name: string } | null;
  content_localizations: Array<{
    locale: string;
    title: string;
    translation_status: string;
  }>;
}

interface Stats {
  published: number;
  scheduled: number;
  inReview: number;
  draft: number;
  total: number;
}

interface ContentListClientProps {
  initialItems: ContentRow[];
  initialTotal: number;
  stats: Stats;
}

/* ── Status tab definitions ────────────────────────────────────────── */

const STATUS_TABS = [
  { key: "all", label: "All Content" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in-review", label: "In Review" },
  { key: "draft", label: "Draft" },
] as const;

type StatusTabKey = (typeof STATUS_TABS)[number]["key"];

/* ── Component ─────────────────────────────────────────────────────── */

export function ContentListClient({
  initialItems,
  initialTotal,
  stats,
}: ContentListClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<ContentRow[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [activeTab, setActiveTab] = useState<StatusTabKey>("all");
  const [search, setSearch] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState(DEFAULT_LIST_LOCALE);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkResetLoading, setBulkResetLoading] = useState(false);

  useEffect(() => {
    setItems(initialItems);
    setTotal(initialTotal);
  }, [initialItems, initialTotal]);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const tabCounts: Record<StatusTabKey, number> = {
    all: stats.total,
    published: stats.published,
    scheduled: stats.scheduled,
    "in-review": stats.inReview,
    draft: stats.draft,
  };

  const topics = useMemo(() => {
    const set = new Set<string>();
    initialItems.forEach((i) => { if (i.topic) set.add(i.topic); });
    return Array.from(set).sort();
  }, [initialItems]);

  const fetchData = useCallback(
    async (params: {
      tab?: StatusTabKey;
      q?: string;
      ct?: string;
      tp?: string;
      lg?: string;
      p?: number;
    }) => {
      setLoading(true);
      try {
        const query = new URLSearchParams();
        const tab = params.tab ?? activeTab;
        const q = params.q ?? search;
        const ct = params.ct ?? contentTypeFilter;
        const tp = params.tp ?? topicFilter;
        const lg = params.lg ?? languageFilter;
        const pg = params.p ?? page;

        if (tab !== "all") query.set("status", tab);
        if (q) query.set("search", q);
        if (ct !== "all") query.set("contentType", ct);
        if (tp !== "all") query.set("topic", tp);
        query.set("locale", lg === "all" ? "all" : lg);
        query.set("page", String(pg));
        query.set("pageSize", String(pageSize));

        const res = await fetch(`/api/admin/resources/content?${query.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      } catch {
        // keep current state
      } finally {
        setLoading(false);
      }
    },
    [activeTab, search, contentTypeFilter, topicFilter, languageFilter, page]
  );

  async function runResetRebuildSelected() {
    const ids = Array.from(selectedIds);
    const ok = confirm(
      `Reset & rebuild ${ids.length} selected item(s)? AI-generated rows will be archived, publish-queue rows cleared, and linked archive topics returned to the backlog. Then use Settings → Run autopilot now to regenerate.`
    );
    if (!ok) return;
    setBulkResetLoading(true);
    try {
      const res = await fetch("/api/admin/resources/reset-and-rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const err =
          typeof data.error === "string" ? data.error : JSON.stringify(data);
        alert(err);
        return;
      }
      const skipped = Array.isArray(data.skippedRequestedIds)
        ? data.skippedRequestedIds.length
        : 0;
      if (skipped > 0) {
        alert(
          `Done. ${skipped} selected row(s) were skipped (not AI-generated or already archived).`
        );
      }
      setSelectedIds(new Set());
      router.refresh();
      await fetchData({});
    } finally {
      setBulkResetLoading(false);
    }
  }

  function onTabChange(tab: StatusTabKey) {
    setActiveTab(tab);
    setPage(1);
    setSelectedIds(new Set());
    fetchData({ tab, p: 1 });
  }

  function onSearchChange(q: string) {
    setSearch(q);
    setPage(1);
    fetchData({ q, p: 1 });
  }

  function onContentTypeChange(ct: string) {
    setContentTypeFilter(ct);
    setPage(1);
    fetchData({ ct, p: 1 });
  }

  function onTopicChange(tp: string) {
    setTopicFilter(tp);
    setPage(1);
    fetchData({ tp, p: 1 });
  }

  function onLanguageChange(lg: string) {
    setLanguageFilter(lg);
    setPage(1);
    fetchData({ lg, p: 1 });
  }

  function onPageChange(p: number) {
    setPage(p);
    fetchData({ p });
  }

  function clearFilters() {
    setContentTypeFilter("all");
    setTopicFilter("all");
    setLanguageFilter(DEFAULT_LIST_LOCALE);
    setSearch("");
    setPage(1);
    fetchData({ ct: "all", tp: "all", lg: DEFAULT_LIST_LOCALE, q: "", p: 1 });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  }

  const hasActiveFilters =
    contentTypeFilter !== "all" ||
    topicFilter !== "all" ||
    languageFilter !== DEFAULT_LIST_LOCALE;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">All Content</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Manage and publish resources across all languages
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/resources/backlog"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
          >
            <ListTodo className="w-4 h-4" />
            View Backlog
          </Link>
          <Link
            href="/admin/resources/content/new"
            className="inline-flex items-center gap-2 bg-[#1D4ED8] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#1E40AF] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Content
          </Link>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex items-center gap-1 border-b border-[#E5E7EB] mb-6 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors relative ${
              activeTab === tab.key
                ? "text-[#1D4ED8]"
                : "text-[#64748B] hover:text-[#0B1220]"
            }`}
          >
            {tab.label}
            <span
              className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                activeTab === tab.key
                  ? "bg-[#EFF6FF] text-[#1D4ED8]"
                  : "bg-[#F1F5F9] text-[#64748B]"
              }`}
            >
              {tabCounts[tab.key]}
            </span>
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1D4ED8] rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Search + filters (always visible — no toggle) */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] mb-4">
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input
              type="text"
              placeholder="Search by title, author, or keyword..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8] transition-colors"
            />
          </div>
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-4 px-4 py-2 bg-[#EFF6FF] border-t border-[#BFDBFE]">
            <span className="text-sm font-medium text-[#1D4ED8]">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              disabled={bulkResetLoading || loading}
              onClick={() => void runResetRebuildSelected()}
              className="inline-flex items-center gap-1.5 text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkResetLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" aria-hidden />
              )}
              Reset &amp; rebuild
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-sm text-[#64748B] hover:text-[#0B1220]"
            >
              Clear selection
            </button>
          </div>
        )}

        <div className="flex flex-wrap sm:flex-nowrap items-end gap-4 px-4 py-3 border-t border-[#E5E7EB] bg-[#F8FAFC] overflow-x-auto">
          <div className="shrink-0 min-w-[9rem]">
            <label className="block text-xs font-medium text-[#64748B] mb-1">
              Content Type
            </label>
            <select
              value={contentTypeFilter}
              onChange={(e) => onContentTypeChange(e.target.value)}
              className="w-full text-sm border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              <option value="all">All types</option>
              {CONTENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {getContentTypeLabel(ct)}
                </option>
              ))}
            </select>
          </div>
          <div className="shrink-0 min-w-[9rem]">
            <label className="block text-xs font-medium text-[#64748B] mb-1">
              Topic
            </label>
            <select
              value={topicFilter}
              onChange={(e) => onTopicChange(e.target.value)}
              className="w-full text-sm border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              <option value="all">All topics</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="shrink-0 min-w-[10rem]">
            <label className="block text-xs font-medium text-[#64748B] mb-1">
              Article language
            </label>
            <select
              value={languageFilter}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="w-full text-sm border border-[#E5E7EB] rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            >
              <option value="all">All languages</option>
              {ADMIN_LOCALES.map((loc) => (
                <option key={loc.dbLocale} value={loc.dbLocale}>
                  {loc.label}
                </option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium shrink-0 pb-1.5"
            >
              <X className="w-3.5 h-3.5" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Content Table */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#64748B] uppercase tracking-wider border-b border-[#E5E7EB] bg-[#F8FAFC]">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-[#D1D5DB] text-[#1D4ED8] focus:ring-[#1D4ED8]"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Topic</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-center">Locales</th>
                <th className="px-4 py-3 font-medium">Published</th>
                <th className="px-4 py-3 font-medium">Author</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[#64748B]">
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-[#64748B]">
                    No content found
                  </td>
                </tr>
              )}
              {items.map((item) => {
                const locs = item.content_localizations ?? [];
                const titleLoc =
                  (item.source_locale
                    ? locs.find((l) => l.locale === item.source_locale)
                    : undefined) ??
                  locs.find((l) => l.locale === "en-US") ??
                  locs[0];

                const localeMap: Record<string, string> = {};
                for (const al of ADMIN_LOCALES) {
                  const match = locs.find((l) => l.locale === al.dbLocale);
                  localeMap[al.dbLocale] = match
                    ? match.translation_status === "complete"
                      ? "complete"
                      : "in-progress"
                    : "missing";
                }

                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-[#F6F8FB] transition-colors ${
                      selectedIds.has(item.id) ? "bg-[#EFF6FF]" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded border-[#D1D5DB] text-[#1D4ED8] focus:ring-[#1D4ED8]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/resources/content/${item.id}`}
                        className="font-medium text-[#0B1220] hover:text-[#1D4ED8] truncate block max-w-[260px]"
                      >
                        {titleLoc?.title ?? "(untitled)"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <ContentTypeBadge type={item.content_type as ContentType} />
                    </td>
                    <td className="px-4 py-3 text-[#64748B] truncate max-w-[120px]">
                      {item.topic ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <WorkflowStatusBadge status={item.workflow_status as WorkflowStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <LocaleStatusIndicator locales={localeMap} />
                    </td>
                    <td className="px-4 py-3 text-[#64748B] whitespace-nowrap">
                      <div className="flex flex-col gap-1 items-start">
                        <span>
                          {item.published_at
                            ? new Date(item.published_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </span>
                        {item.workflow_status === "published" && !item.published_at && (
                          <span
                            className="text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                            title="Workflow is Published but go-live never completed. Use Settings → Repair stuck publishes, or fix the queue row and Process publish queue."
                          >
                            Not on public hub
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">
                      {(() => {
                        const a = item.authors;
                        if (Array.isArray(a)) return a[0]?.name ?? "—";
                        if (a && typeof a === "object" && "name" in a) return a.name;
                        return "—";
                      })()}
                    </td>
                    <td className="px-4 py-3 text-[#64748B] whitespace-nowrap">
                      {item.updated_at
                        ? new Date(item.updated_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/admin/resources/content/${item.id}`}
                          className="p-1.5 hover:bg-[#F1F5F9] rounded transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4 text-[#64748B]" />
                        </Link>
                        <button
                          className="p-1.5 hover:bg-[#F1F5F9] rounded transition-colors"
                          title="More actions"
                        >
                          <MoreHorizontal className="w-4 h-4 text-[#64748B]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E7EB]">
          <p className="text-sm text-[#64748B]">
            Showing {Math.min((page - 1) * pageSize + 1, total)}–
            {Math.min(page * pageSize, total)} of {total} items
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-[#64748B]" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange(pageNum)}
                  className={`w-9 h-9 text-sm rounded-lg font-medium transition-colors ${
                    page === pageNum
                      ? "bg-[#1D4ED8] text-white"
                      : "text-[#64748B] hover:bg-[#F1F5F9]"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-[#64748B]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  Plus,
  ChevronUp,
  ChevronDown,
  X,
  Lightbulb,
  InboxIcon,
  FileCheck,
  AlertTriangle,
} from "lucide-react";
import { PriorityBadge, WorkflowStatusBadge } from "@/components/admin/resources";
import type { Priority, WorkflowStatus } from "@/lib/resources/workflow";

interface BacklogItem {
  id: string;
  proposed_title: string;
  target_keyword: string | null;
  search_intent: string | null;
  priority_score: number;
  status: string;
  content_type: string | null;
  notes: string | null;
  [key: string]: unknown;
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
  const [items, setItems] = useState<BacklogItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.proposed_title?.toLowerCase().includes(q) ||
          i.target_keyword?.toLowerCase().includes(q)
      );
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

  function moveItem(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= filtered.length) return;
    const next = [...items];
    const fromIdx = next.findIndex((i) => i.id === filtered[index].id);
    const toIdx = next.findIndex((i) => i.id === filtered[to].id);
    if (fromIdx === -1 || toIdx === -1) return;
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    setItems(next);
  }

  const hasActiveFilters = priorityFilter !== "all" || statusFilter !== "all";
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
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/resources/list"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
          >
            View Published
          </Link>
          <button className="inline-flex items-center gap-2 bg-[#1D4ED8] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#1E40AF] transition-colors">
            <Plus className="w-4 h-4" />
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
                <th className="px-4 py-3 font-medium w-16">#</th>
                <th className="px-4 py-3 font-medium">Title</th>
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
                  <td colSpan={8} className="px-4 py-12 text-center text-[#64748B]">
                    No backlog items found
                  </td>
                </tr>
              )}
              {filtered.map((item, idx) => (
                <tr key={item.id} className="hover:bg-[#F6F8FB] transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[#64748B] w-5 text-right">{idx + 1}</span>
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => moveItem(idx, -1)}
                          disabled={idx === 0}
                          className="p-0.5 hover:bg-[#E5E7EB] rounded disabled:opacity-30"
                        >
                          <ChevronUp className="w-3 h-3 text-[#64748B]" />
                        </button>
                        <button
                          onClick={() => moveItem(idx, 1)}
                          disabled={idx === filtered.length - 1}
                          className="p-0.5 hover:bg-[#E5E7EB] rounded disabled:opacity-30"
                        >
                          <ChevronDown className="w-3 h-3 text-[#64748B]" />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#0B1220] truncate max-w-[260px]">
                      {item.proposed_title}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-[#64748B] truncate max-w-[260px] mt-0.5">
                        {item.notes}
                      </p>
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
                    <WorkflowStatusBadge status={item.status as WorkflowStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium whitespace-nowrap">
                      Convert to Draft
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E5E7EB] text-sm text-[#64748B]">
          <span>Showing {filtered.length} of {items.length} items</span>
          {readyCount > 0 && (
            <span className="text-[#22C55E] font-medium">{readyCount} ready to start</span>
          )}
        </div>
      </div>
    </div>
  );
}

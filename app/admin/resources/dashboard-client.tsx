"use client";

import Link from "next/link";
import {
  CheckCircle,
  Clock,
  Eye,
  Edit,
  Plus,
  ChevronRight,
  Activity,
} from "lucide-react";
import { WorkflowStatusBadge, ContentTypeBadge, PriorityBadge, LocaleFlags } from "@/components/admin/resources";
import type { ContentType, WorkflowStatus, Priority } from "@/lib/resources/workflow";

/* ── Types ─────────────────────────────────────────────────────────── */

interface Stats {
  published: number;
  scheduled: number;
  inReview: number;
  draft: number;
  total: number;
}

interface UpcomingItem {
  id: string;
  scheduled_for: string;
  content_localizations: Record<string, unknown>;
}

interface TranslationGap {
  contentItemId: string;
  title: string;
  missingLocales: string[];
  priority: string;
}

interface RecentItem {
  id: string;
  content_type: string;
  workflow_status: string;
  updated_at: string;
  authors: Array<{ name: string }> | { name: string } | null;
  content_localizations: Array<{ locale: string; title: string }>;
}

interface DashboardProps {
  stats: Stats | null;
  upcoming: UpcomingItem[];
  gaps: TranslationGap[];
  recent: RecentItem[];
  queueSize: number;
}

/* ── Component ─────────────────────────────────────────────────────── */

export function ResourcesDashboardClient({
  stats,
  upcoming,
  gaps,
  recent,
  queueSize,
}: DashboardProps) {
  const s = stats ?? { published: 0, scheduled: 0, inReview: 0, draft: 0, total: 0 };

  const kpis: Array<{
    label: string;
    value: number;
    sub: string;
    icon: React.ElementType;
    iconColor: string;
    iconBg: string;
  }> = [
    {
      label: "Published",
      value: s.published,
      sub: "Total live",
      icon: CheckCircle,
      iconColor: "text-[#22C55E]",
      iconBg: "bg-[#F0FDF4]",
    },
    {
      label: "Scheduled",
      value: s.scheduled,
      sub: "Next 30 days",
      icon: Clock,
      iconColor: "text-[#3B82F6]",
      iconBg: "bg-[#EFF6FF]",
    },
    {
      label: "In Review",
      value: s.inReview,
      sub: s.inReview > 0 ? `${s.inReview} need attention` : "All clear",
      icon: Eye,
      iconColor: "text-[#F59E0B]",
      iconBg: "bg-[#FEF3C7]",
    },
    {
      label: "Draft",
      value: s.draft,
      sub: s.draft > 0 ? `${s.draft} in progress` : "None",
      icon: Edit,
      iconColor: "text-[#64748B]",
      iconBg: "bg-[#F1F5F9]",
    },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Resources Hub Admin</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Manage articles, templates, and knowledge base content
          </p>
        </div>
        <Link
          href="/admin/resources/content/new"
          className="inline-flex items-center gap-2 bg-[#1D4ED8] text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-[#1E40AF] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Content
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="bg-white rounded-xl border border-[#E2E8F0] p-5 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[#64748B]">{kpi.label}</span>
                <div className={`w-9 h-9 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${kpi.iconColor}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-[#0F172A]">{kpi.value}</p>
              <p className="text-xs text-[#64748B] mt-1">{kpi.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Two-column: Upcoming Scheduled + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Upcoming Scheduled — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#E2E8F0]">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">Upcoming Scheduled</h2>
              <p className="text-xs text-[#64748B] mt-0.5">Next posts to go live</p>
            </div>
            <Link
              href="/admin/resources/calendar"
              className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium flex items-center gap-1"
            >
              View Calendar
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {upcoming.length === 0 && (
              <p className="px-5 py-8 text-sm text-[#64748B] text-center">
                No scheduled posts
              </p>
            )}
            {upcoming.map((item) => {
              const raw = item.content_localizations as Record<string, unknown>;
              const loc = Array.isArray(raw) ? raw[0] : raw;
              const title = (loc as Record<string, unknown>)?.title as string | undefined;
              const locale = (loc as Record<string, unknown>)?.locale as string | undefined;
              const ci = (loc as Record<string, unknown>)?.content_items as Record<string, unknown> | undefined;
              const contentType = (Array.isArray(ci) ? (ci[0] as Record<string, unknown>)?.content_type : ci?.content_type) as string | undefined;
              return (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[#F8FAFC] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0F172A] truncate">
                      {title ?? "(untitled)"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {contentType && (
                        <ContentTypeBadge type={contentType as ContentType} />
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm text-[#0F172A]">
                      {item.scheduled_for
                        ? new Date(item.scheduled_for).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </p>
                    <p className="text-xs text-[#64748B]">
                      {item.scheduled_for
                        ? new Date(item.scheduled_for).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </p>
                  </div>
                  {locale && (
                    <LocaleFlags localeCodes={[locale]} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar — 1/3 width */}
        <div className="space-y-6">
          {/* Translation Gaps */}
          <div className="bg-white rounded-xl border border-[#E2E8F0]">
            <div className="px-5 py-4 border-b border-[#E2E8F0]">
              <h2 className="text-base font-semibold text-[#0F172A]">Translation Gaps</h2>
              <p className="text-xs text-[#64748B] mt-0.5">Missing locale translations</p>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {gaps.length === 0 && (
                <p className="px-5 py-6 text-sm text-[#64748B] text-center">
                  All translations complete
                </p>
              )}
              {gaps.map((gap) => (
                <div key={gap.contentItemId} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[#0F172A] truncate flex-1">
                      {gap.title}
                    </p>
                    <PriorityBadge priority={gap.priority as Priority} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="text-xs text-[#64748B]">Missing:</span>
                    <LocaleFlags localeCodes={gap.missingLocales} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Queue Health */}
          <div className="bg-white rounded-xl border border-[#E2E8F0]">
            <div className="px-5 py-4 border-b border-[#E2E8F0]">
              <h2 className="text-base font-semibold text-[#0F172A]">Queue Health</h2>
            </div>
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-[#F0FDF4] flex items-center justify-center">
                  <Activity className="w-5 h-5 text-[#22C55E]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#0F172A]">Operational</p>
                  <p className="text-xs text-[#64748B]">Cron publishing active</p>
                </div>
              </div>
              <div className="flex justify-between text-sm border-t border-[#E2E8F0] pt-3">
                <span className="text-[#64748B]">Queue size</span>
                <span className="font-medium text-[#0F172A]">{queueSize} pending</span>
              </div>
              <Link
                href="/admin/resources/queue"
                className="mt-3 block text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
              >
                View Queue Details →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Recently Edited */}
      <div className="bg-white rounded-xl border border-[#E2E8F0]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">Recently Edited</h2>
            <p className="text-xs text-[#64748B] mt-0.5">Latest content changes</p>
          </div>
          <Link
            href="/admin/resources/list"
            className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium flex items-center gap-1"
          >
            View All Content
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[#64748B] uppercase tracking-wider border-b border-[#E2E8F0]">
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Author</th>
                <th className="px-5 py-3 font-medium">Last Edited</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[#64748B]">
                    No content yet
                  </td>
                </tr>
              )}
              {recent.map((item) => {
                const locs = item.content_localizations as Array<{ locale: string; title: string }>;
                const enLoc = locs?.find((l) => l.locale === "en-US") ?? locs?.[0];
                return (
                  <tr key={item.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-[#0F172A] truncate max-w-[300px]">
                        {enLoc?.title ?? "(untitled)"}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <ContentTypeBadge type={item.content_type as ContentType} />
                    </td>
                    <td className="px-5 py-3 text-[#64748B]">
                      {(() => {
                        const a = item.authors;
                        if (Array.isArray(a)) return a[0]?.name ?? "—";
                        if (a && typeof a === "object" && "name" in a) return a.name;
                        return "—";
                      })()}
                    </td>
                    <td className="px-5 py-3 text-[#64748B] whitespace-nowrap">
                      {item.updated_at
                        ? new Date(item.updated_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <WorkflowStatusBadge status={item.workflow_status as WorkflowStatus} />
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/resources/content/${item.id}`}
                        className="text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

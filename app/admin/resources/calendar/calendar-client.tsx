"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  List,
  Globe,
  Activity,
  Clock,
  Zap,
} from "lucide-react";
import { ContentTypeBadge, WorkflowStatusBadge } from "@/components/admin/resources";
import type { ContentType } from "@/lib/resources/workflow";

interface ScheduledItem {
  id: string;
  scheduled_for: string;
  status: string;
  content_localizations: Record<string, unknown>;
  [key: string]: unknown;
}

interface CalendarClientProps {
  initialItems: ScheduledItem[];
}

function getTitle(item: ScheduledItem): string {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  return ((loc as Record<string, unknown>)?.title as string) ?? "(untitled)";
}

function getContentType(item: ScheduledItem): string | undefined {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  const ci = (loc as Record<string, unknown>)?.content_items as Record<string, unknown>;
  const ciArr = Array.isArray(ci) ? ci[0] : ci;
  return (ciArr as Record<string, unknown>)?.content_type as string | undefined;
}

function getLocale(item: ScheduledItem): string | undefined {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  return (loc as Record<string, unknown>)?.locale as string | undefined;
}

export function CalendarClient({ initialItems }: CalendarClientProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [view, setView] = useState<"agenda" | "calendar">("agenda");

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  function prevMonth() {
    setCurrentMonth(new Date(year, month - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth(new Date(year, month + 1, 1));
  }

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ScheduledItem[]>();
    for (const item of initialItems) {
      if (!item.scheduled_for) continue;
      const dateKey = item.scheduled_for.split("T")[0];
      const existing = map.get(dateKey) ?? [];
      existing.push(item);
      map.set(dateKey, existing);
    }
    return map;
  }, [initialItems]);

  const monthItems = useMemo(() => {
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = `${year}-${String(month + 1).padStart(2, "0")}-31`;
    const entries = Array.from(itemsByDate.entries())
      .filter(([date]) => date >= start && date <= end)
      .sort(([a], [b]) => a.localeCompare(b));
    return entries;
  }, [itemsByDate, year, month]);

  const thisWeekCount = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return initialItems.filter((i) => {
      if (!i.scheduled_for) return false;
      const d = new Date(i.scheduled_for);
      return d >= now && d <= weekEnd;
    }).length;
  }, [initialItems]);

  const totalScheduled = initialItems.length;

  /* ── Calendar grid ──────────────────────────────────────────────── */

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
  const weeks: Array<Array<number | null>> = [];
  let day = 1;
  for (let w = 0; w < 6 && day <= daysInMonth; w++) {
    const week: Array<number | null> = [];
    for (let d = 0; d < 7; d++) {
      if ((w === 0 && d < firstDow) || day > daysInMonth) {
        week.push(null);
      } else {
        week.push(day++);
      }
    }
    weeks.push(week);
  }

  function dayKey(d: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Publishing Calendar</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Schedule and manage upcoming content releases
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-[#E5E7EB] overflow-hidden">
            <button
              onClick={() => setView("agenda")}
              className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 ${
                view === "agenda" ? "bg-[#0B1220] text-white" : "text-[#64748B] hover:bg-[#F8FAFC]"
              }`}
            >
              <List className="w-4 h-4" /> Agenda
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`px-3 py-2 text-sm font-medium flex items-center gap-1.5 ${
                view === "calendar" ? "bg-[#0B1220] text-white" : "text-[#64748B] hover:bg-[#F8FAFC]"
              }`}
            >
              <CalendarIcon className="w-4 h-4" /> Calendar
            </button>
          </div>
          <Link
            href="/admin/resources/queue"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
          >
            View Queue
          </Link>
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="p-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC]">
            <ChevronLeft className="w-4 h-4 text-[#64748B]" />
          </button>
          <h2 className="text-lg font-semibold text-[#0B1220]">
            {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </h2>
          <button onClick={nextMonth} className="p-2 rounded-lg border border-[#E5E7EB] hover:bg-[#F8FAFC]">
            <ChevronRight className="w-4 h-4 text-[#64748B]" />
          </button>
        </div>
        <div className="flex items-center gap-4 text-sm text-[#64748B]">
          <span><strong className="text-[#0B1220]">{totalScheduled}</strong> scheduled</span>
          <span><strong className="text-[#0B1220]">{thisWeekCount}</strong> this week</span>
        </div>
      </div>

      {/* Agenda view */}
      {view === "agenda" && (
        <div className="space-y-6">
          {monthItems.length === 0 && (
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-12 text-center">
              <CalendarIcon className="w-12 h-12 text-[#E1E3E5] mx-auto mb-4" />
              <p className="text-[#64748B]">No scheduled posts this month</p>
            </div>
          )}
          {monthItems.map(([date, dayItems]) => {
            const d = new Date(date + "T00:00:00");
            return (
              <div key={date} className="flex gap-6">
                <div className="w-24 shrink-0 text-center bg-white border border-[#E5E7EB] rounded-xl p-3">
                  <p className="text-xs text-[#64748B] uppercase">
                    {d.toLocaleDateString("en-US", { weekday: "short" })}
                  </p>
                  <p className="text-3xl font-bold text-[#0B1220]">{d.getDate()}</p>
                  <p className="text-xs text-[#64748B]">
                    {d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs text-[#1D4ED8] font-medium mt-1">
                    {dayItems.length} post{dayItems.length > 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex-1 space-y-2">
                  {dayItems.map((item) => {
                    const time = item.scheduled_for
                      ? new Date(item.scheduled_for).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "";
                    const ct = getContentType(item);
                    const locale = getLocale(item);
                    return (
                      <div
                        key={item.id}
                        className="bg-white border border-[#E5E7EB] rounded-xl p-4 flex items-center gap-4 hover:shadow-sm transition-shadow"
                      >
                        <span className="text-sm font-medium text-[#64748B] w-16 shrink-0">
                          {time}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {ct && <ContentTypeBadge type={ct as ContentType} />}
                            <WorkflowStatusBadge status="scheduled" />
                          </div>
                          <p className="text-sm font-medium text-[#0B1220] truncate">
                            {getTitle(item)}
                          </p>
                        </div>
                        {locale && (
                          <div className="flex items-center gap-1 text-xs text-[#64748B]">
                            <Globe className="w-3.5 h-3.5" />
                            {locale}
                          </div>
                        )}
                        <Link
                          href={`/admin/resources/content/${item.id}`}
                          className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
                        >
                          Edit
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Calendar grid view */}
      {view === "calendar" && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
          <div className="grid grid-cols-7 text-center text-xs font-medium text-[#64748B] uppercase tracking-wider border-b border-[#E5E7EB] bg-[#F8FAFC]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-3">{d}</div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 border-b border-[#E5E7EB] last:border-b-0">
              {week.map((d, di) => {
                const dk = d ? dayKey(d) : null;
                const dayPosts = dk ? (itemsByDate.get(dk) ?? []) : [];
                const hasContent = dayPosts.length > 0;
                return (
                  <div
                    key={di}
                    className={`min-h-[80px] p-2 border-r border-[#E5E7EB] last:border-r-0 ${
                      hasContent ? "border-[#1D4ED8] bg-[#EFF6FF]/30" : ""
                    } ${!d ? "bg-[#F8FAFC]" : ""}`}
                  >
                    {d && (
                      <>
                        <p className={`text-sm ${hasContent ? "font-bold text-[#1D4ED8]" : "text-[#64748B]"}`}>
                          {d}
                        </p>
                        {dayPosts.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {dayPosts.map((_, j) => (
                              <span key={j} className="w-2 h-2 rounded-full bg-[#1D4ED8]" />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Queue health panel */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#F0FDF4] flex items-center justify-center">
            <Activity className="w-5 h-5 text-[#22C55E]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#0B1220]">System Status</p>
            <p className="text-xs text-[#22C55E] font-medium">Operational</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
            <Clock className="w-5 h-5 text-[#3B82F6]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#0B1220]">Queue Size</p>
            <p className="text-xs text-[#64748B]">{totalScheduled} pending</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#FEF3C7] flex items-center justify-center">
            <Zap className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#0B1220]">Cadence</p>
            <p className="text-xs text-[#64748B]">Monitoring active</p>
          </div>
        </div>
      </div>
    </div>
  );
}

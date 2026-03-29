"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Clock,
  Loader2,
  CheckCircle,
  AlertCircle,
  Inbox,
  Globe,
  RotateCcw,
} from "lucide-react";

interface QueueItem {
  id: string;
  scheduled_for: string;
  status: string;
  last_error: string | null;
  attempts: number;
  created_at: string;
  content_localizations: Record<string, unknown>;
  [key: string]: unknown;
}

interface QueueClientProps {
  initialItems: QueueItem[];
}

const STATUS_TABS = [
  { key: "all", label: "All Items" },
  { key: "pending", label: "Pending" },
  { key: "processing", label: "Processing" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
] as const;

type TabKey = (typeof STATUS_TABS)[number]["key"];

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; animate?: boolean }> = {
  pending: { icon: Clock, color: "text-[#64748B]", bg: "bg-[#F1F5F9]" },
  processing: { icon: Loader2, color: "text-[#3B82F6]", bg: "bg-[#EFF6FF]", animate: true },
  succeeded: { icon: CheckCircle, color: "text-[#22C55E]", bg: "bg-[#F0FDF4]" },
  failed: { icon: AlertCircle, color: "text-[#EF4444]", bg: "bg-[#FEF2F2]" },
};

function getTitle(item: QueueItem): string {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  return ((loc as Record<string, unknown>)?.title as string) ?? "(untitled)";
}

function getLocale(item: QueueItem): string | undefined {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  return (loc as Record<string, unknown>)?.locale as string | undefined;
}

function getContentType(item: QueueItem): string | undefined {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  const ci = (loc as Record<string, unknown>)?.content_items as Record<string, unknown>;
  const ciArr = Array.isArray(ci) ? ci[0] : ci;
  return (ciArr as Record<string, unknown>)?.content_type as string | undefined;
}

function getContentItemId(item: QueueItem): string | undefined {
  const raw = item.content_localizations;
  const loc = Array.isArray(raw) ? raw[0] : raw;
  const id = (loc as Record<string, unknown>)?.content_item_id;
  return typeof id === "string" ? id : undefined;
}

export function QueueClient({ initialItems }: QueueClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [publishRunning, setPublishRunning] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (activeTab === "all") return initialItems;
    return initialItems.filter((i) => i.status === activeTab);
  }, [initialItems, activeTab]);

  const counts = useMemo(() => ({
    all: initialItems.length,
    pending: initialItems.filter((i) => i.status === "pending").length,
    processing: initialItems.filter((i) => i.status === "processing").length,
    succeeded: initialItems.filter((i) => i.status === "succeeded").length,
    failed: initialItems.filter((i) => i.status === "failed").length,
  }), [initialItems]);

  async function processPublishQueueNow() {
    setPublishRunning(true);
    setPublishMessage(null);
    try {
      const res = await fetch("/api/admin/resources/cron/publish", { method: "POST" });
      const data = (await res.json()) as { error?: string; processed?: number };
      if (!res.ok) {
        setPublishMessage(data.error ?? "Publish queue run failed");
        return;
      }
      setPublishMessage(`Processed ${data.processed ?? 0} row(s). Only items whose scheduled time has passed (UTC) are published.`);
      router.refresh();
    } catch {
      setPublishMessage("Network error");
    } finally {
      setPublishRunning(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Publishing Queue</h1>
          <p className="text-sm text-[#64748B] mt-1">
            Monitor and manage scheduled content publishing
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={publishRunning}
            onClick={() => processPublishQueueNow()}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg bg-[#0B1220] text-white hover:bg-[#1E293B] disabled:opacity-50 transition-colors"
          >
            {publishRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </>
            ) : (
              "Process publish queue now"
            )}
          </button>
          <Link
            href="/admin/resources/calendar"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
          >
            View Calendar
          </Link>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F8FAFC] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Pending", count: counts.pending, icon: Clock, color: "text-[#64748B]", bg: "bg-[#F1F5F9]" },
          { label: "Processing", count: counts.processing, icon: Loader2, color: "text-[#3B82F6]", bg: "bg-[#EFF6FF]" },
          { label: "Succeeded", count: counts.succeeded, icon: CheckCircle, color: "text-[#22C55E]", bg: "bg-[#F0FDF4]" },
          { label: "Failed", count: counts.failed, icon: AlertCircle, color: "text-[#EF4444]", bg: "bg-[#FEF2F2]" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-xl border border-[#E5E7EB] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[#64748B]">{s.label}</span>
                <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${s.color}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-[#0B1220]">{s.count}</p>
            </div>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "bg-[#0B1220] text-white"
                : "text-[#64748B] hover:bg-[#F1F5F9]"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-80">{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      {publishMessage && (
        <p className="text-sm text-[#64748B] mb-4" role="status">
          {publishMessage}
        </p>
      )}
      <p className="text-xs text-[#64748B] mb-4">
        Pending rows run only when their <strong>scheduled</strong> time is in the past (server UTC). After 7:20 PM on that date (in UTC), click{" "}
        <strong>Process publish queue now</strong> or use{" "}
        <Link href="/admin/resources/settings" className="text-[#1D4ED8] underline">
          Settings → Process publish queue now
        </Link>
        . The daily cron does the same at 09:00 UTC.
      </p>

      {/* Queue items */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-12 text-center">
            <Inbox className="w-12 h-12 text-[#E1E3E5] mx-auto mb-4" />
            <p className="text-[#64748B]">No items found</p>
          </div>
        )}
        {filtered.map((item) => {
          const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
          const Icon = cfg.icon;
          const locale = getLocale(item);
          const ct = getContentType(item);
          const contentItemId = getContentItemId(item);
          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-[#E5E7EB] p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${cfg.color} ${cfg.animate ? "animate-spin" : ""}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium text-[#0B1220] truncate">
                      {getTitle(item)}
                    </span>
                    {ct && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#64748B]">
                        {ct.replace(/_/g, " ")}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.color}`}>
                      {item.status}
                    </span>
                    {locale && (
                      <span className="text-xs text-[#64748B] flex items-center gap-1">
                        <Globe className="w-3 h-3" /> {locale}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-[#64748B] mt-2">
                    <div>
                      <span className="font-medium">Scheduled:</span>{" "}
                      {item.scheduled_for
                        ? new Date(item.scheduled_for).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </div>
                    <div>
                      <span className="font-medium">Created:</span>{" "}
                      {new Date(item.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div>
                      <span className="font-medium">Attempts:</span> {item.attempts}
                    </div>
                  </div>
                  {item.last_error && (
                    <div className="mt-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                      <p className="text-xs text-[#DC2626]">{item.last_error}</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {contentItemId ? (
                    <Link
                      href={`/admin/resources/content/${contentItemId}`}
                      className="text-sm text-[#1D4ED8] hover:text-[#1E40AF] font-medium"
                    >
                      View
                    </Link>
                  ) : (
                    <span className="text-sm text-[#94A3B8]">View</span>
                  )}
                  {item.status === "failed" && (
                    <button className="inline-flex items-center gap-1 text-sm text-[#F59E0B] hover:text-[#D97706] font-medium">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* System status */}
      <div className="mt-8 bg-white rounded-xl border border-[#E5E7EB] p-5">
        <h3 className="text-base font-semibold text-[#0B1220] mb-4">System Status</h3>
        <div className="space-y-3">
          {[
            { name: "Publishing Service", status: "Operational", time: "< 100ms" },
            { name: "Translation Service", status: "Operational", time: "< 200ms" },
            { name: "CDN Distribution", status: "Operational", time: "< 50ms" },
          ].map((svc) => (
            <div key={svc.name} className="flex items-center justify-between py-2 border-b border-[#E5E7EB] last:border-b-0">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-[#22C55E]" />
                <span className="text-sm text-[#0B1220]">{svc.name}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-[#64748B]">
                <span className="text-[#22C55E] font-medium">{svc.status}</span>
                <span>Response: {svc.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

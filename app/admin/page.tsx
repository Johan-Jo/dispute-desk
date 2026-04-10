"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Store,
  FileText,
  Package,
  Cog,
  AlertTriangle,
  CheckCircle,
  Clock,
  GitBranch,
  Activity,
  ArrowRight,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";

interface Metrics {
  shops: { total: number; active: number; uninstalled: number };
  disputes: number;
  packs: { total: number; byStatus: Record<string, number> };
  jobs: { queued: number; running: number; failed: number };
  plans: Record<string, number>;
  reasonMappings?: { total: number; mapped: number; unmapped: number };
}

interface AuditEvent {
  id: string;
  event_type: string;
  actor_type: string;
  shop_id: string | null;
  created_at: string;
  event_payload: Record<string, unknown>;
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [recentActivity, setRecentActivity] = useState<AuditEvent[]>([]);

  useEffect(() => {
    fetch("/api/admin/metrics")
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {});
    fetch("/api/admin/audit?format=json")
      .then((r) => r.json())
      .then((data: AuditEvent[]) => setRecentActivity(Array.isArray(data) ? data.slice(0, 5) : []))
      .catch(() => {});
  }, []);

  if (!metrics) {
    return (
      <div className="p-8">
        <div className="text-[#64748B] py-12 text-center">Loading dashboard...</div>
      </div>
    );
  }

  const needsAttention = [
    ...(metrics.reasonMappings && metrics.reasonMappings.unmapped > 0
      ? [
          {
            type: "error" as const,
            label: "Unmapped dispute reasons",
            count: metrics.reasonMappings.unmapped,
            action: "Review mapping",
            path: "/admin/reason-mapping",
          },
        ]
      : []),
    ...(metrics.jobs.failed > 0
      ? [
          {
            type: "error" as const,
            label: "Failed jobs",
            count: metrics.jobs.failed,
            action: "View jobs",
            path: "/admin/jobs",
          },
        ]
      : []),
    ...(metrics.shops.uninstalled > 0
      ? [
          {
            type: "warning" as const,
            label: "Uninstalled shops",
            count: metrics.shops.uninstalled,
            action: "Review shops",
            path: "/admin/shops",
          },
        ]
      : []),
  ];

  const planEntries = Object.entries(metrics.plans).sort((a, b) => b[1] - a[1]);
  const totalShops = metrics.shops.total || 1;

  const planColors: Record<string, string> = {
    enterprise: "#8B5CF6",
    scale: "#8B5CF6",
    professional: "#3B82F6",
    growth: "#3B82F6",
    starter: "#22C55E",
    trial: "#94A3B8",
    free: "#94A3B8",
  };

  function getEventStatusStyle(eventType: string) {
    if (eventType.includes("fail") || eventType.includes("error"))
      return { bg: "bg-[#FEE2E2]", icon: AlertTriangle, iconColor: "text-[#DC2626]" };
    if (eventType.includes("queue") || eventType.includes("build") || eventType.includes("process"))
      return { bg: "bg-[#FEF3C7]", icon: Clock, iconColor: "text-[#F59E0B]" };
    return { bg: "bg-[#D1FAE5]", icon: CheckCircle, iconColor: "text-[#065F46]" };
  }

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Admin Overview"
        subtitle="Internal platform operations and health monitoring"
      />

      {/* KPIs */}
      <AdminStatsRow
        cards={[
          {
            label: "Active Shops",
            value: metrics.shops.active,
            icon: Store,
          },
          {
            label: "Total Disputes",
            value: metrics.disputes,
            icon: FileText,
          },
          {
            label: "Evidence Packs",
            value: metrics.packs.total,
            icon: Package,
          },
          {
            label: "Queued Jobs",
            value: metrics.jobs.queued,
            change: metrics.jobs.failed > 0 ? `${metrics.jobs.failed} failed` : undefined,
            changeType: metrics.jobs.failed > 0 ? "down" : undefined,
            icon: Cog,
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Needs Attention */}
        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
              <h2 className="text-lg font-semibold text-[#0F172A]">Needs Attention</h2>
            </div>
            {needsAttention.length > 0 && (
              <span className="px-3 py-1 bg-[#FEF3C7] text-[#92400E] text-xs font-semibold rounded-full">
                {needsAttention.length} {needsAttention.length === 1 ? "issue" : "issues"}
              </span>
            )}
          </div>
          {needsAttention.length > 0 ? (
            <div className="divide-y divide-[#E2E8F0]">
              {needsAttention.map((item, index) => (
                <div
                  key={index}
                  className="px-6 py-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        item.type === "error" ? "bg-[#EF4444]" : "bg-[#F59E0B]"
                      }`}
                    />
                    <div>
                      <div className="text-sm font-medium text-[#0F172A]">{item.label}</div>
                      <div className="text-xs text-[#64748B]">
                        {item.count} {item.count === 1 ? "item" : "items"} require review
                      </div>
                    </div>
                  </div>
                  <Link
                    href={item.path}
                    className="px-4 py-2 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors"
                  >
                    {item.action}
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-6 py-8 text-center">
              <CheckCircle className="w-8 h-8 text-[#22C55E] mx-auto mb-2" />
              <p className="text-sm text-[#64748B]">All clear — no issues require attention</p>
            </div>
          )}
        </div>

        {/* Plan Distribution */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0]">
            <h2 className="text-lg font-semibold text-[#0F172A]">Plan Distribution</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {planEntries.map(([plan, count]) => {
                const color = planColors[plan.toLowerCase()] ?? "#94A3B8";
                return (
                  <div key={plan}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-sm font-medium text-[#0F172A] capitalize">
                          {plan}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-[#0F172A]">{count}</span>
                    </div>
                    <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-500 rounded-full"
                        style={{
                          width: `${(count / totalShops) * 100}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Reason Mapping", href: "/admin/reason-mapping", icon: GitBranch, color: "from-[#8B5CF6] to-[#EC4899]" },
          { label: "Templates", href: "/admin/templates", icon: FileText, color: "from-[#1D4ED8] to-[#3B82F6]" },
          { label: "Template Health", href: "/admin/template-health", icon: Activity, color: "from-[#059669] to-[#10B981]" },
          { label: "Job Monitor", href: "/admin/jobs", icon: Cog, color: "from-[#D97706] to-[#F59E0B]" },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group bg-white border border-[#E2E8F0] rounded-lg p-4 hover:border-[#3B82F6] hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-9 h-9 bg-gradient-to-br ${action.color} rounded-lg flex items-center justify-center`}>
                <action.icon className="w-4 h-4 text-white" />
              </div>
              <ArrowRight className="w-4 h-4 text-[#94A3B8] group-hover:text-[#1D4ED8] transition-colors" />
            </div>
            <span className="text-sm font-semibold text-[#0F172A]">{action.label}</span>
          </Link>
        ))}
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-[#E2E8F0] rounded-lg">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#0F172A]">Recent Activity</h2>
          <Link
            href="/admin/audit"
            className="text-sm text-[#1D4ED8] font-semibold hover:text-[#1E40AF]"
          >
            View all
          </Link>
        </div>
        {recentActivity.length > 0 ? (
          <div className="divide-y divide-[#E2E8F0]">
            {recentActivity.map((event) => {
              const style = getEventStatusStyle(event.event_type);
              const StatusIcon = style.icon;
              return (
                <div
                  key={event.id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${style.bg}`}
                    >
                      <StatusIcon className={`w-4 h-4 ${style.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#0F172A]">
                        {event.event_type.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-[#64748B] truncate">
                        {event.shop_id || event.actor_type}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-[#94A3B8]">
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-[#64748B]">No recent activity</p>
          </div>
        )}
      </div>
    </div>
  );
}

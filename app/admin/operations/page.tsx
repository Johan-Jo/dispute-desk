"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Store,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldAlert,
  RefreshCw,
  Zap,
  XCircle,
  Eye,
  ArrowLeft,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// ─── Types ──────────────────────────────────────────────────────────────

interface DisputeMetrics {
  needsAttentionCount: number;
  overriddenCount: number | null;
  syncIssueCount: number | null;
  disputesWithNotesCount: number | null;
}

interface ShopLeaderboardEntry {
  shopId: string;
  domain: string;
  attention: number;
  syncFail: number;
  overridden: number;
  stale: number;
  uncertain: number;
  total: number;
}

interface OpsEvent {
  id: string;
  disputeId: string;
  shopId: string;
  shopDomain: string;
  orderName: string;
  eventType: string;
  description: string | null;
  eventAt: string;
  actorType: string;
  actorRef: string | null;
  severity: "error" | "info" | "success";
}

interface Metrics {
  jobs: { queued: number; running: number; failed: number };
  reasonMappings: { total: number; mapped: number; unmapped: number };
  shops: { total: number; active: number; uninstalled: number };
  disputeMetrics: DisputeMetrics;
  submissionUncertainCount: number;
  staleCount: number;
  shopLeaderboard: ShopLeaderboardEntry[];
  recentOpsActivity: OpsEvent[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  sync_failed: "Sync Failed",
  pack_build_failed: "Pack Build Failed",
  evidence_save_failed: "Evidence Save Failed",
  admin_override: "Admin Override",
  admin_override_cleared: "Override Cleared",
  support_note_added: "Support Note Added",
  dispute_resynced: "Dispute Resynced",
  outcome_detected: "Outcome Detected",
  submission_confirmed: "Submission Confirmed",
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

// ─── Page ───────────────────────────────────────────────────────────────

export default function OperationsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    fetch("/api/admin/metrics")
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {});
  }, []);

  if (!metrics) {
    return (
      <div className="p-8">
        <div className="text-[#64748B] py-12 text-center">Loading operations...</div>
      </div>
    );
  }

  const dm = metrics.disputeMetrics;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin" className="text-[#64748B] hover:text-[#0F172A] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <AdminPageHeader
          title="Operations Queue"
          subtitle="Manual review, exceptions, and customer-case triage"
        />
      </div>

      {/* ── Ops Counters ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <OpsCounter label="Needs Attention" value={dm.needsAttentionCount} severity={dm.needsAttentionCount > 0 ? "error" : "ok"} icon={AlertTriangle} href="/admin/disputes?needs_attention=true" />
        <OpsCounter label="Failed Jobs" value={metrics.jobs.failed} severity={metrics.jobs.failed > 0 ? "error" : "ok"} icon={XCircle} href="/admin/jobs" />
        <OpsCounter label="Sync Issues" value={dm.syncIssueCount ?? 0} severity={(dm.syncIssueCount ?? 0) > 0 ? "warning" : "ok"} icon={RefreshCw} href="/admin/disputes?sync_health=failing" />
        <OpsCounter label="Uncertain Submission" value={metrics.submissionUncertainCount} severity={metrics.submissionUncertainCount > 0 ? "warning" : "ok"} icon={Eye} href="/admin/disputes?submission_state=submission_uncertain" />
        <OpsCounter label="Overridden" value={dm.overriddenCount ?? 0} severity="neutral" icon={ShieldAlert} href="/admin/disputes?has_admin_override=true" />
        <OpsCounter label="Stale (7d+)" value={metrics.staleCount} severity={metrics.staleCount > 0 ? "warning" : "ok"} icon={Clock} />
      </div>

      {/* ── Triage Queue ───────────────────────────────────────────────── */}
      <TriagePanel metrics={metrics} dm={dm} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Shops Needing Intervention ──────────────────────────────── */}
        <ShopLeaderboard entries={metrics.shopLeaderboard} />

        {/* ── Ops Activity ───────────────────────────────────────────── */}
        <OpsActivityFeed events={metrics.recentOpsActivity} />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function OpsCounter({ label, value, severity, icon: Icon, href }: {
  label: string;
  value: number;
  severity: "error" | "warning" | "neutral" | "ok";
  icon: typeof AlertTriangle;
  href?: string;
}) {
  const styles = {
    error: { bg: "bg-[#FEF2F2]", border: "border-[#FECACA]", text: "text-[#DC2626]", icon: "text-[#DC2626]" },
    warning: { bg: "bg-[#FFFBEB]", border: "border-[#FDE68A]", text: "text-[#D97706]", icon: "text-[#D97706]" },
    neutral: { bg: "bg-[#F8FAFC]", border: "border-[#E2E8F0]", text: "text-[#475569]", icon: "text-[#64748B]" },
    ok: { bg: "bg-white", border: "border-[#E2E8F0]", text: "text-[#10B981]", icon: "text-[#10B981]" },
  };
  const s = value > 0 ? styles[severity] : styles.ok;

  const inner = (
    <div className={`${s.bg} ${s.border} border rounded-lg p-4`}>
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-4 h-4 ${s.icon}`} />
        {value > 0 && severity !== "ok" && severity !== "neutral" && (
          <span className={`w-2 h-2 rounded-full ${severity === "error" ? "bg-[#EF4444]" : "bg-[#F59E0B]"} animate-pulse`} />
        )}
      </div>
      <p className={`text-2xl font-bold ${value > 0 ? s.text : "text-[#10B981]"}`}>{value}</p>
      <p className="text-xs text-[#64748B] mt-1">{label}</p>
    </div>
  );

  return href && value > 0 ? (
    <Link href={href} className="hover:shadow-sm transition-shadow">{inner}</Link>
  ) : inner;
}

function TriagePanel({ metrics, dm }: { metrics: Metrics; dm: DisputeMetrics }) {
  const items: { type: "error" | "warning" | "info"; label: string; detail: string; count: number; path: string; action: string }[] = [];

  if (dm.needsAttentionCount > 0) {
    items.push({ type: "error", label: "Disputes needing attention", detail: `${dm.needsAttentionCount} disputes flagged for manual review or intervention`, count: dm.needsAttentionCount, path: "/admin/disputes?needs_attention=true", action: "Triage now" });
  }
  if (metrics.jobs.failed > 0) {
    items.push({ type: "error", label: "Failed jobs", detail: `${metrics.jobs.failed} jobs failed — may include pack builds, syncs, or saves`, count: metrics.jobs.failed, path: "/admin/jobs", action: "View jobs" });
  }
  if ((dm.syncIssueCount ?? 0) > 0) {
    items.push({ type: "error", label: "Sync health issues", detail: `${dm.syncIssueCount} disputes with degraded sync`, count: dm.syncIssueCount ?? 0, path: "/admin/disputes?sync_health=failing", action: "Review syncs" });
  }
  if (metrics.submissionUncertainCount > 0) {
    items.push({ type: "warning", label: "Submission uncertain", detail: `${metrics.submissionUncertainCount} disputes where submission could not be confirmed`, count: metrics.submissionUncertainCount, path: "/admin/disputes?submission_state=submission_uncertain", action: "Verify" });
  }
  if (metrics.staleCount > 0) {
    items.push({ type: "warning", label: "Stale open disputes", detail: `${metrics.staleCount} open disputes with no activity in 7+ days`, count: metrics.staleCount, path: "/admin/disputes", action: "Review" });
  }
  if ((dm.overriddenCount ?? 0) > 0) {
    items.push({ type: "info", label: "Admin overrides active", detail: `${dm.overriddenCount} disputes have manual overrides`, count: dm.overriddenCount ?? 0, path: "/admin/disputes?has_admin_override=true", action: "View" });
  }
  if ((dm.disputesWithNotesCount ?? 0) > 0) {
    items.push({ type: "info", label: "Disputes with support notes", detail: `${dm.disputesWithNotesCount} disputes have internal notes`, count: dm.disputesWithNotesCount ?? 0, path: "/admin/disputes", action: "View" });
  }
  if (metrics.reasonMappings.unmapped > 0) {
    items.push({ type: "warning", label: "Unmapped reasons", detail: `${metrics.reasonMappings.unmapped} reason codes have no template`, count: metrics.reasonMappings.unmapped, path: "/admin/reason-mapping", action: "Map reasons" });
  }
  if (metrics.shops.uninstalled > 0) {
    items.push({ type: "info", label: "Uninstalled shops", detail: `${metrics.shops.uninstalled} shops uninstalled`, count: metrics.shops.uninstalled, path: "/admin/shops", action: "Review" });
  }

  const dotColor = { error: "bg-[#EF4444]", warning: "bg-[#F59E0B]", info: "bg-[#3B82F6]" };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg">
      <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Triage Queue</h2>
        </div>
        {items.length > 0 && (
          <span className="px-3 py-1 bg-[#FEF3C7] text-[#92400E] text-xs font-semibold rounded-full">
            {items.length} {items.length === 1 ? "issue" : "issues"}
          </span>
        )}
      </div>
      {items.length > 0 ? (
        <div className="divide-y divide-[#E2E8F0]">
          {items.map((item, i) => (
            <div key={i} className="px-6 py-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-2.5 h-2.5 rounded-full ${dotColor[item.type]} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#0F172A]">
                    {item.label}
                    <span className="ml-2 text-xs font-semibold text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-full">{item.count}</span>
                  </div>
                  <div className="text-xs text-[#64748B] truncate">{item.detail}</div>
                </div>
              </div>
              <Link href={item.path} className="px-4 py-2 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors flex-shrink-0 ml-4">
                {item.action}
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-6 py-8 text-center">
          <CheckCircle className="w-8 h-8 text-[#22C55E] mx-auto mb-2" />
          <p className="text-sm text-[#64748B]">All clear — no operational exceptions</p>
        </div>
      )}
    </div>
  );
}

function ShopLeaderboard({ entries }: { entries: ShopLeaderboardEntry[] }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg">
      <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
        <Store className="w-5 h-5 text-[#EF4444]" />
        <h2 className="text-lg font-semibold text-[#0F172A]">Shops Needing Intervention</h2>
      </div>
      {entries.length > 0 ? (
        <div className="divide-y divide-[#E2E8F0]">
          {entries.map((shop) => (
            <Link key={shop.shopId} href={`/admin/disputes?shop_id=${shop.shopId}`} className="px-6 py-3 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors block">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#0F172A] truncate">{shop.domain}</p>
                <div className="flex gap-3 mt-1">
                  {shop.attention > 0 && <Tag color="#EF4444" label={`${shop.attention} attn`} />}
                  {shop.syncFail > 0 && <Tag color="#D97706" label={`${shop.syncFail} sync`} />}
                  {shop.stale > 0 && <Tag color="#6B7280" label={`${shop.stale} stale`} />}
                  {shop.uncertain > 0 && <Tag color="#8B5CF6" label={`${shop.uncertain} uncertain`} />}
                  {shop.overridden > 0 && <Tag color="#3B82F6" label={`${shop.overridden} override`} />}
                </div>
              </div>
              <span className="text-lg font-bold text-[#0F172A] ml-4">{shop.total}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="px-6 py-8 text-center">
          <CheckCircle className="w-8 h-8 text-[#22C55E] mx-auto mb-2" />
          <p className="text-sm text-[#64748B]">No shops need intervention</p>
        </div>
      )}
    </div>
  );
}

function Tag({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color, background: `${color}15` }}>
      {label}
    </span>
  );
}

function OpsActivityFeed({ events }: { events: OpsEvent[] }) {
  const severityIcon = {
    error: { Icon: XCircle, bg: "bg-[#FEE2E2]", color: "text-[#DC2626]" },
    info: { Icon: ShieldAlert, bg: "bg-[#EFF6FF]", color: "text-[#1D4ED8]" },
    success: { Icon: CheckCircle, bg: "bg-[#D1FAE5]", color: "text-[#065F46]" },
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg">
      <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#8B5CF6]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Ops Activity</h2>
        </div>
        <Link href="/admin/audit" className="text-sm text-[#1D4ED8] font-semibold hover:text-[#1E40AF]">Full audit log</Link>
      </div>
      {events.length > 0 ? (
        <div className="divide-y divide-[#E2E8F0]">
          {events.map((event) => {
            const sev = severityIcon[event.severity];
            return (
              <Link key={event.id} href={`/admin/disputes/${event.disputeId}`} className="px-6 py-3 flex items-center gap-4 hover:bg-[#F8FAFC] transition-colors block">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${sev.bg} flex-shrink-0`}>
                  <sev.Icon className={`w-4 h-4 ${sev.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#0F172A]">{EVENT_LABELS[event.eventType] ?? event.eventType.replace(/_/g, " ")}</span>
                    <span className="text-xs text-[#64748B]">{event.orderName}</span>
                  </div>
                  <div className="text-xs text-[#64748B] truncate">
                    {event.shopDomain}
                    {event.actorRef ? ` · ${event.actorRef}` : ` · ${event.actorType}`}
                    {event.description ? ` — ${event.description}` : ""}
                  </div>
                </div>
                <span className="text-xs text-[#94A3B8] flex-shrink-0">{relativeTime(event.eventAt)}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-[#64748B]">No recent ops events</p>
        </div>
      )}
    </div>
  );
}

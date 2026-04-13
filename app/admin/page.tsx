"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Store,
  FileText,
  Cog,
  AlertTriangle,
  CheckCircle,
  Clock,
  GitBranch,
  Activity,
  ArrowRight,
  RefreshCw,
  Zap,
  XCircle,
  BarChart3,
  TrendingUp,
  Percent,
  DollarSign,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

// ─── Types ──────────────────────────────────────────────────────────────

interface DisputeMetrics {
  activeDisputes: number;
  disputesWon: number;
  disputesLost: number;
  totalClosed: number;
  amountAtRisk: number;
  amountRecovered: number;
  amountLost: number;
  winRate: number;
  avgTimeToSubmit: number | null;
  avgTimeToClose: number | null;
  statusBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  needsAttentionCount: number;
  overriddenCount: number | null;
  syncIssueCount: number | null;
  disputesWithNotesCount: number | null;
  currencyCode: string;
}

interface Metrics {
  shops: { total: number; active: number; uninstalled: number };
  disputes: number;
  packs: { total: number; byStatus: Record<string, number> };
  jobs: { queued: number; running: number; failed: number };
  plans: Record<string, number>;
  templates: { total: number; active: number; draft: number; archived: number };
  reasonMappings: { total: number; mapped: number; unmapped: number };
  disputeMetrics: DisputeMetrics;
  automationSuccessRate: number;
  saveSuccessRate: number;
  manualInterventionRate: number;
  submissionUncertainCount: number;
  uncertainRate: number;
  staleCount: number;
  topBlockers: { blocker: string; count: number }[];
  topFailingTypes: { disputeType: string; count: number }[];
  unmappedReasons: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toFixed(0)}`;
  }
}

const STATUS_COLORS: Record<string, string> = {
  new: "#6B7280", in_progress: "#3B82F6", needs_review: "#F59E0B",
  ready_to_submit: "#8B5CF6", action_needed: "#EF4444", submitted: "#06B6D4",
  waiting_on_issuer: "#6366F1", won: "#10B981", lost: "#DC2626",
  accepted_not_contested: "#9CA3AF", closed_other: "#9CA3AF",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New", in_progress: "In Progress", needs_review: "Needs Review",
  ready_to_submit: "Ready to Submit", action_needed: "Action Needed",
  submitted: "Submitted", waiting_on_issuer: "Waiting on Issuer",
  won: "Won", lost: "Lost", accepted_not_contested: "Accepted", closed_other: "Closed",
};

const OUTCOME_COLORS: Record<string, string> = {
  won: "#10B981", lost: "#EF4444", partially_won: "#F59E0B",
  accepted: "#6B7280", refunded: "#6B7280", canceled: "#9CA3AF",
  expired: "#9CA3AF", closed_other: "#9CA3AF", unknown: "#D1D5DB",
};

// ─── Dashboard ──────────────────────────────────────────────────────────

export default function AdminDashboard() {
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
        <div className="text-[#64748B] py-12 text-center">Loading dashboard...</div>
      </div>
    );
  }

  const dm = metrics.disputeMetrics;

  // Derive health signals
  const healthSignals: { label: string; ok: boolean; detail: string }[] = [
    { label: "Sync", ok: (dm.syncIssueCount ?? 0) === 0, detail: dm.syncIssueCount ? `${dm.syncIssueCount} issues` : "Healthy" },
    { label: "Jobs", ok: metrics.jobs.failed === 0, detail: metrics.jobs.failed ? `${metrics.jobs.failed} failed` : "Clear" },
    { label: "Mappings", ok: metrics.reasonMappings.unmapped === 0, detail: metrics.reasonMappings.unmapped ? `${metrics.reasonMappings.unmapped} unmapped` : "Complete" },
    { label: "Automation", ok: metrics.automationSuccessRate >= 80, detail: `${metrics.automationSuccessRate}%` },
  ];

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <AdminPageHeader
          title="Platform Overview"
          subtitle="Is DisputeDesk healthy? Where are the bottlenecks?"
        />
        <Link
          href="/admin/operations"
          className="px-4 py-2 bg-[#FEF3C7] text-[#92400E] text-sm font-semibold rounded-lg hover:bg-[#FDE68A] transition-colors flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4" />
          Operations Queue
          {(dm.needsAttentionCount + metrics.jobs.failed + (dm.syncIssueCount ?? 0)) > 0 && (
            <span className="ml-1 px-2 py-0.5 bg-[#DC2626] text-white text-xs font-bold rounded-full">
              {dm.needsAttentionCount + metrics.jobs.failed + (dm.syncIssueCount ?? 0)}
            </span>
          )}
        </Link>
      </div>

      {/* ── 1. Health Status Bar ────────────────────────────────────────── */}
      <div className="flex gap-3">
        {healthSignals.map((sig) => (
          <div
            key={sig.label}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${sig.ok ? "bg-[#F0FDF4] border-[#BBF7D0]" : "bg-[#FEF2F2] border-[#FECACA]"}`}
          >
            <div className={`w-2 h-2 rounded-full ${sig.ok ? "bg-[#22C55E]" : "bg-[#EF4444] animate-pulse"}`} />
            <span className="text-xs font-semibold text-[#374151]">{sig.label}</span>
            <span className={`text-xs ${sig.ok ? "text-[#15803D]" : "text-[#DC2626]"}`}>{sig.detail}</span>
          </div>
        ))}
      </div>

      {/* ── 2. Platform KPIs ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KpiCard icon={Store} label="Active Shops" value={String(metrics.shops.active)} />
        <KpiCard icon={FileText} label="Disputes Processed" value={String(metrics.disputes)} />
        <KpiCard icon={Zap} label="Automation Success" value={`${metrics.automationSuccessRate}%`} tone={metrics.automationSuccessRate >= 80 ? "good" : "warn"} />
        <KpiCard icon={RefreshCw} label="Save-to-Shopify Rate" value={`${metrics.saveSuccessRate}%`} tone={metrics.saveSuccessRate >= 80 ? "good" : "warn"} />
        <KpiCard icon={TrendingUp} label="Win Rate" value={`${dm.winRate}%`} tone={dm.winRate >= 50 ? "good" : "neutral"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KpiCard icon={DollarSign} label="Amount Recovered" value={formatCurrency(dm.amountRecovered, dm.currencyCode)} tone="good" />
        <KpiCard icon={Clock} label="Avg. Time to Submit" value={dm.avgTimeToSubmit != null ? `${dm.avgTimeToSubmit}d` : "—"} />
        <KpiCard icon={Clock} label="Avg. Time to Close" value={dm.avgTimeToClose != null ? `${dm.avgTimeToClose}d` : "—"} />
        <KpiCard icon={Percent} label="Manual Intervention" value={`${metrics.manualInterventionRate}%`} tone={metrics.manualInterventionRate <= 10 ? "good" : "warn"} />
        <KpiCard icon={Percent} label="Submission Uncertainty" value={`${metrics.uncertainRate}%`} tone={metrics.uncertainRate <= 5 ? "good" : "warn"} />
      </div>

      {/* ── 3. Systemic Bottlenecks ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Blockers */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
            <XCircle className="w-4 h-4 text-[#EF4444]" />
            <h2 className="text-sm font-semibold text-[#0F172A]">Top Evidence Blockers</h2>
          </div>
          {metrics.topBlockers.length > 0 ? (
            <div className="p-4 space-y-2">
              {metrics.topBlockers.map((b) => (
                <div key={b.blocker} className="flex items-center justify-between">
                  <span className="text-sm text-[#374151] truncate flex-1">{b.blocker.replace(/_/g, " ")}</span>
                  <span className="text-sm font-semibold text-[#0F172A] ml-2">{b.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="No blockers" />
          )}
        </div>

        {/* Top Failing Types */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
            <h2 className="text-sm font-semibold text-[#0F172A]">Failing Dispute Types</h2>
          </div>
          {metrics.topFailingTypes.length > 0 ? (
            <div className="p-4 space-y-2">
              {metrics.topFailingTypes.map((t) => (
                <div key={t.disputeType} className="flex items-center justify-between">
                  <span className="text-sm text-[#374151] truncate flex-1">{t.disputeType.replace(/_/g, " ")}</span>
                  <span className="text-sm font-semibold text-[#EF4444] ml-2">{t.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState label="No failures" />
          )}
        </div>

        {/* Weak Reason Mappings */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-[#8B5CF6]" />
              <h2 className="text-sm font-semibold text-[#0F172A]">Unmapped Reasons</h2>
            </div>
            {metrics.unmappedReasons.length > 0 && (
              <Link href="/admin/reason-mapping" className="text-xs text-[#1D4ED8] font-semibold hover:underline">
                Fix
              </Link>
            )}
          </div>
          {metrics.unmappedReasons.length > 0 ? (
            <div className="p-4 space-y-1">
              {metrics.unmappedReasons.slice(0, 8).map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#EF4444] flex-shrink-0" />
                  <span className="text-sm text-[#374151]">{r.replace(/_/g, " ")}</span>
                </div>
              ))}
              {metrics.unmappedReasons.length > 8 && (
                <p className="text-xs text-[#64748B] mt-2">+{metrics.unmappedReasons.length - 8} more</p>
              )}
            </div>
          ) : (
            <EmptyState label="All reasons mapped" ok />
          )}
        </div>
      </div>

      {/* ── 4. Dispute Health ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#3B82F6]" />
            <h2 className="text-sm font-semibold text-[#0F172A]">Status Distribution</h2>
          </div>
          <div className="p-6">
            <StatusBar breakdown={dm.statusBreakdown} />
          </div>
        </div>

        {/* Outcome Breakdown */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#10B981]" />
            <h2 className="text-sm font-semibold text-[#0F172A]">Outcome Breakdown</h2>
          </div>
          <div className="p-6">
            <OutcomeBar breakdown={dm.outcomeBreakdown} />
          </div>
        </div>
      </div>

      {/* ── 5. Quick Actions ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Disputes", href: "/admin/disputes", icon: FileText, color: "from-[#1D4ED8] to-[#3B82F6]" },
          { label: "Reason Mapping", href: "/admin/reason-mapping", icon: GitBranch, color: "from-[#8B5CF6] to-[#EC4899]" },
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

      {/* ── 6. Platform Summary (demoted) ─────────────────────────────── */}
      <div className="border-t border-[#E2E8F0] pt-6">
        <h3 className="text-sm font-semibold text-[#64748B] uppercase tracking-wider mb-4">Platform Summary</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Total Shops", value: metrics.shops.total },
              { label: "Uninstalled", value: metrics.shops.uninstalled },
              { label: "Templates", value: metrics.templates.total },
              { label: "Active Templates", value: metrics.templates.active },
            ].map((c) => (
              <div key={c.label} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                <p className="text-xs text-[#64748B]">{c.label}</p>
                <p className="text-xl font-bold text-[#0F172A]">{c.value}</p>
              </div>
            ))}
          </div>

          <PlanDistribution plans={metrics.plans} total={metrics.shops.total} />

          <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
            <h4 className="text-sm font-semibold text-[#0F172A] mb-3">Financials</h4>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-[#64748B]">Amount at Risk</p>
                <p className="text-lg font-bold text-[#D97706]">{formatCurrency(dm.amountAtRisk, dm.currencyCode)}</p>
              </div>
              <div>
                <p className="text-xs text-[#64748B]">Amount Recovered</p>
                <p className="text-lg font-bold text-[#10B981]">{formatCurrency(dm.amountRecovered, dm.currencyCode)}</p>
              </div>
              <div>
                <p className="text-xs text-[#64748B]">Amount Lost</p>
                <p className="text-lg font-bold text-[#EF4444]">{formatCurrency(dm.amountLost, dm.currencyCode)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, tone }: {
  icon: typeof Store;
  label: string;
  value: string;
  tone?: "good" | "warn" | "neutral";
}) {
  const valueColor = tone === "good" ? "text-[#15803D]" : tone === "warn" ? "text-[#D97706]" : "text-[#0F172A]";
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#64748B] font-medium">{label}</p>
        <Icon className="w-4 h-4 text-[#94A3B8]" />
      </div>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}

function EmptyState({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="px-6 py-6 text-center">
      {ok && <CheckCircle className="w-6 h-6 text-[#22C55E] mx-auto mb-1" />}
      <p className="text-sm text-[#64748B]">{label}</p>
    </div>
  );
}

function StatusBar({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p className="text-sm text-[#64748B]">No disputes</p>;

  return (
    <>
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {entries.map(([status, count]) => (
          <div
            key={status}
            style={{ width: `${(count / total) * 100}%`, background: STATUS_COLORS[status] ?? "#9CA3AF" }}
            title={`${STATUS_LABELS[status] ?? status}: ${count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([status, count]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[status] ?? "#9CA3AF" }} />
            <span className="text-xs text-[#64748B]">{STATUS_LABELS[status] ?? status}</span>
            <span className="text-xs font-semibold text-[#0F172A]">{count}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function OutcomeBar({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p className="text-sm text-[#64748B]">No outcomes yet</p>;

  return (
    <div className="space-y-2">
      {entries.map(([outcome, count]) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={outcome}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[#374151] capitalize">{outcome.replace(/_/g, " ")}</span>
              <span className="text-[#64748B]">{count} ({pct}%)</span>
            </div>
            <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: OUTCOME_COLORS[outcome] ?? "#9CA3AF" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlanDistribution({ plans, total }: { plans: Record<string, number>; total: number }) {
  const planEntries = Object.entries(plans).sort((a, b) => b[1] - a[1]);
  const t = total || 1;
  const planColors: Record<string, string> = {
    enterprise: "#8B5CF6", scale: "#8B5CF6", professional: "#3B82F6",
    growth: "#3B82F6", starter: "#22C55E", trial: "#94A3B8", free: "#94A3B8",
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-4">
      <h4 className="text-sm font-semibold text-[#0F172A] mb-3">Plan Distribution</h4>
      <div className="space-y-3">
        {planEntries.map(([plan, count]) => {
          const color = planColors[plan.toLowerCase()] ?? "#94A3B8";
          return (
            <div key={plan}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#374151] capitalize">{plan}</span>
                <span className="font-semibold text-[#0F172A]">{count}</span>
              </div>
              <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(count / t) * 100}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

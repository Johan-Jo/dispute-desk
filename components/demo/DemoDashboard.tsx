"use client";

import Link from "next/link";
import { AlertTriangle, TrendingUp, Sparkles, Clock, ArrowRight, ChevronRight } from "lucide-react";
import { DEMO_DISPUTES } from "@/lib/demo/fixtures/disputes";
import { DEMO_DASHBOARD_STATS, DEMO_ACTIVITY } from "@/lib/demo/fixtures/dashboardStats";

function KpiCard({
  label,
  value,
  subtitle,
  subtitleTone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  subtitleTone?: "neutral" | "positive" | "warning";
}) {
  const subtitleColor =
    subtitleTone === "positive" ? "text-[#10B981]" : subtitleTone === "warning" ? "text-[#F59E0B]" : "text-[#6B7280]";

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
      <div className="text-xs text-[#6B7280] font-medium mb-1">{label}</div>
      <div className="text-2xl font-semibold text-[#0B1220] leading-tight">{value}</div>
      {subtitle && <div className={`text-xs font-medium mt-1.5 ${subtitleColor}`}>{subtitle}</div>}
    </div>
  );
}

export function DemoDashboard() {
  const stats = DEMO_DASHBOARD_STATS;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0B1220]">Dashboard</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">{new Date("2026-01-15T10:00:00Z").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · Demo store</p>
      </div>

      {/* Urgent banner — present because dp-2406 is parked for review */}
      <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-[#991B1B]">{stats.urgentCount} dispute needs your attention</div>
              <div className="text-sm text-[#991B1B] mt-0.5">$312.00 at risk · earliest deadline in 4 days</div>
            </div>
          </div>
          <Link
            href="/demo/disputes/dp-2406"
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium rounded-md bg-[#DC2626] text-white hover:bg-[#B91C1C] transition-colors"
          >
            Resolve now
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Needs action" value={String(stats.needsActionCount)} subtitle={`${stats.urgentCount} urgent`} subtitleTone="warning" />
        <KpiCard label="Amount at risk" value={`$${stats.amountAtRisk.toFixed(2)}`} />
        <KpiCard label="Strong cases" value={String(stats.strongCasesCount)} subtitle="Ready to submit" subtitleTone="positive" />
        <KpiCard label="Win rate (30d)" value={`${stats.winRate30d}%`} subtitle={`$${stats.amountRecovered30d.toLocaleString("en-US")} recovered`} subtitleTone="positive" />
      </div>

      {/* Recent disputes preview */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
          <h3 className="text-sm font-semibold text-[#0B1220]">Recent disputes</h3>
          <Link href="/demo/disputes" className="text-xs text-[#1D4ED8] hover:underline inline-flex items-center gap-0.5">
            View all
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
        <ul className="divide-y divide-[#F1F2F4]">
          {DEMO_DISPUTES.slice(0, 5).map((d) => (
            <li key={d.id}>
              <Link
                href={`/demo/disputes/${d.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="min-w-0 flex-1 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#0B1220] truncate">{d.orderName} · {d.customerName}</div>
                    <div className="text-xs text-[#6B7280] truncate">{d.reasonLabel} · {d.statusLabel}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-sm font-medium text-[#0B1220]">${d.amount.toFixed(2)}</div>
                  <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Two-column: activity + insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#E5E7EB] bg-white">
          <div className="px-5 py-4 border-b border-[#E5E7EB]">
            <h3 className="text-sm font-semibold text-[#0B1220]">Recent activity</h3>
          </div>
          <ul className="px-5 py-3 space-y-2.5">
            {DEMO_ACTIVITY.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-[#7C3AED] mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[#0B1220]">{a.orderName} — {a.description}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] mt-0.5">
                    {new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-[#E5E7EB] bg-white">
          <div className="px-5 py-4 border-b border-[#E5E7EB]">
            <h3 className="text-sm font-semibold text-[#0B1220]">Insights</h3>
          </div>
          <ul className="px-5 py-3 space-y-3">
            <li className="flex items-start gap-2.5">
              <TrendingUp className="w-4 h-4 text-[#10B981] flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="text-[#0B1220] font-medium">Fraud win rate up 12 points</div>
                <div className="text-xs text-[#6B7280] mt-0.5">3-D Secure adoption is paying off — 92% on cases with 3DS authenticated.</div>
              </div>
            </li>
            <li className="flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-[#7C3AED] flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="text-[#0B1220] font-medium">{stats.strongCasesCount} packs auto-built today</div>
                <div className="text-xs text-[#6B7280] mt-0.5">Average pack build time: 4 seconds. Zero merchant input required.</div>
              </div>
            </li>
            <li className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="text-[#0B1220] font-medium">1 case approaching deadline</div>
                <div className="text-xs text-[#6B7280] mt-0.5">dp-2406 needs your input within 4 days.</div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

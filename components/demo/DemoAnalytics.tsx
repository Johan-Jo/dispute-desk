"use client";

import { DEMO_ANALYTICS, DEMO_ANALYTICS_TOTALS } from "@/lib/demo/fixtures/analytics";

export function DemoAnalytics() {
  const maxCount = Math.max(...DEMO_ANALYTICS.map((p) => p.count));
  const maxRecovered = Math.max(...DEMO_ANALYTICS.map((p) => p.recovered));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0B1220]">Analytics</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">Last 90 days · trends and outcomes</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
          <div className="text-xs text-[#6B7280] font-medium">Disputes handled</div>
          <div className="text-2xl font-semibold text-[#0B1220] mt-1">{DEMO_ANALYTICS_TOTALS.disputesHandled90d}</div>
          <div className="text-xs text-[#6B7280] mt-1">90-day total</div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
          <div className="text-xs text-[#6B7280] font-medium">Recovered</div>
          <div className="text-2xl font-semibold text-[#10B981] mt-1">${DEMO_ANALYTICS_TOTALS.amountRecovered90d.toLocaleString("en-US")}</div>
          <div className="text-xs text-[#6B7280] mt-1">90-day total</div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
          <div className="text-xs text-[#6B7280] font-medium">Win rate</div>
          <div className="text-2xl font-semibold text-[#0B1220] mt-1">{DEMO_ANALYTICS_TOTALS.winRate90d}%</div>
          <div className="text-xs text-[#10B981] font-medium mt-1">+12 pts vs prior period</div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
          <div className="text-xs text-[#6B7280] font-medium">Avg response time</div>
          <div className="text-2xl font-semibold text-[#0B1220] mt-1">{DEMO_ANALYTICS_TOTALS.avgResponseTimeHours}h</div>
          <div className="text-xs text-[#6B7280] mt-1">Auto-build to ready</div>
        </div>
      </div>

      {/* Chart 1: weekly dispute volume */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
        <h3 className="text-sm font-semibold text-[#0B1220] mb-1">Disputes per week</h3>
        <p className="text-xs text-[#6B7280] mb-5">Last 11 weeks</p>
        <div className="flex items-end gap-2 h-48">
          {DEMO_ANALYTICS.map((p) => (
            <div key={p.weekStart} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="text-[10px] text-[#0B1220] font-medium">{p.count}</div>
              <div
                className="w-full bg-[#7C3AED] rounded-t transition-all"
                style={{ height: `${(p.count / maxCount) * 100}%`, minHeight: 4 }}
              />
              <div className="text-[10px] text-[#9CA3AF] truncate w-full text-center">{new Date(p.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart 2: weekly recovered */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5">
        <h3 className="text-sm font-semibold text-[#0B1220] mb-1">Recovered per week</h3>
        <p className="text-xs text-[#6B7280] mb-5">Last 11 weeks · USD</p>
        <div className="flex items-end gap-2 h-48">
          {DEMO_ANALYTICS.map((p) => (
            <div key={p.weekStart} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="text-[10px] text-[#0B1220] font-medium">${(p.recovered / 1000).toFixed(1)}k</div>
              <div
                className="w-full bg-[#10B981] rounded-t transition-all"
                style={{ height: `${(p.recovered / maxRecovered) * 100}%`, minHeight: 4 }}
              />
              <div className="text-[10px] text-[#9CA3AF] truncate w-full text-center">{new Date(p.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

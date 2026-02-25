"use client";

import { useState, useEffect } from "react";

interface Metrics {
  shops: { total: number; active: number; uninstalled: number };
  disputes: number;
  packs: { total: number; byStatus: Record<string, number> };
  jobs: { queued: number; running: number; failed: number };
  plans: Record<string, number>;
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    fetch("/api/admin/metrics").then((r) => r.json()).then(setMetrics);
  }, []);

  if (!metrics) {
    return <div className="text-[#667085] py-12 text-center">Loading dashboard...</div>;
  }

  const cards = [
    { label: "Active Shops", value: metrics.shops.active, sub: `${metrics.shops.uninstalled} uninstalled` },
    { label: "Total Disputes", value: metrics.disputes },
    { label: "Evidence Packs", value: metrics.packs.total },
    { label: "Queued Jobs", value: metrics.jobs.queued, sub: `${metrics.jobs.failed} failed` },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0B1220] mb-6">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg border border-[#E5E7EB] p-4">
            <p className="text-sm text-[#667085]">{c.label}</p>
            <p className="text-2xl font-bold text-[#0B1220]">{c.value}</p>
            {c.sub && <p className="text-xs text-[#94A3B8]">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <h3 className="font-semibold text-[#0B1220] mb-3">Plan Distribution</h3>
          {Object.entries(metrics.plans).map(([plan, count]) => (
            <div key={plan} className="flex justify-between text-sm py-1">
              <span className="text-[#667085] capitalize">{plan}</span>
              <span className="font-medium text-[#0B1220]">{count}</span>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <h3 className="font-semibold text-[#0B1220] mb-3">Pack Status Breakdown</h3>
          {Object.entries(metrics.packs.byStatus).map(([status, count]) => (
            <div key={status} className="flex justify-between text-sm py-1">
              <span className="text-[#667085]">{status.replace(/_/g, " ")}</span>
              <span className="font-medium text-[#0B1220]">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

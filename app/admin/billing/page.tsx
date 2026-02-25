"use client";

import { useState, useEffect } from "react";

interface BillingData {
  mrr: number;
  distribution: Record<string, number>;
  perShop: { shop_id: string; domain: string; plan: string; used: number; limit: number }[];
}

export default function AdminBillingPage() {
  const [data, setData] = useState<BillingData | null>(null);

  useEffect(() => {
    fetch("/api/admin/billing").then((r) => r.json()).then(setData);
  }, []);

  if (!data) return <div className="text-[#667085] py-12 text-center">Loading billing data...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0B1220] mb-6">Billing Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-sm text-[#667085]">Monthly Recurring Revenue</p>
          <p className="text-3xl font-bold text-[#059669]">${data.mrr.toFixed(2)}</p>
        </div>
        {Object.entries(data.distribution).map(([plan, count]) => (
          <div key={plan} className="bg-white rounded-lg border border-[#E5E7EB] p-4">
            <p className="text-sm text-[#667085] capitalize">{plan} Plan</p>
            <p className="text-3xl font-bold text-[#0B1220]">{count}</p>
            <p className="text-xs text-[#94A3B8]">active shops</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="px-4 py-3 bg-[#F7F8FA] font-semibold text-sm text-[#0B1220]">
          Per-Shop Usage (This Month)
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E5E7EB]">
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Shop</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Packs Used</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Usage</th>
            </tr>
          </thead>
          <tbody>
            {data.perShop.map((s) => {
              const pct = s.limit > 0 ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0;
              return (
                <tr key={s.shop_id} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA]">
                  <td className="px-4 py-3 font-medium">{s.domain}</td>
                  <td className="px-4 py-3 capitalize">{s.plan}</td>
                  <td className="px-4 py-3">{s.used} / {s.limit === Infinity ? "∞" : s.limit}</td>
                  <td className="px-4 py-3 w-40">
                    <div className="w-full h-2 bg-[#E5E7EB] rounded-full">
                      <div
                        className={`h-2 rounded-full ${pct >= 90 ? "bg-[#DC2626]" : pct >= 70 ? "bg-[#F59E0B]" : "bg-[#059669]"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

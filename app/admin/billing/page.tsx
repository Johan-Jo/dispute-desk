"use client";

import { useState, useEffect } from "react";
import { DollarSign, Users, TrendingUp, ArrowUpRight } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminTable } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface BillingData {
  mrr: number;
  distribution: Record<string, number>;
  perShop: { shop_id: string; domain: string; plan: string; used: number; limit: number }[];
}

export default function AdminBillingPage() {
  const [data, setData] = useState<BillingData | null>(null);

  useEffect(() => {
    fetch("/api/admin/billing")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="p-8">
        <div className="text-[#64748B] py-12 text-center">Loading billing data...</div>
      </div>
    );
  }

  const totalShops = Object.values(data.distribution).reduce((a, b) => a + b, 0);

  const planColors: Record<string, string> = {
    enterprise: "#8B5CF6",
    scale: "#8B5CF6",
    professional: "#3B82F6",
    growth: "#3B82F6",
    starter: "#22C55E",
    trial: "#94A3B8",
    free: "#94A3B8",
  };

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Billing Dashboard"
        subtitle="Revenue metrics and subscription analytics"
        icon={DollarSign}
        iconGradient="from-[#22C55E] to-[#16A34A]"
      />

      <AdminStatsRow
        cards={[
          {
            label: "Monthly Recurring Revenue",
            value: `$${data.mrr.toFixed(2)}`,
            icon: DollarSign,
            iconBg: "bg-[#DCFCE7]",
            iconColor: "text-[#22C55E]",
            valueColor: "text-[#22C55E]",
          },
          {
            label: "Active Subscriptions",
            value: totalShops,
            icon: Users,
            iconBg: "bg-[#DBEAFE]",
            iconColor: "text-[#3B82F6]",
          },
          {
            label: "Average Revenue Per Shop",
            value: totalShops > 0 ? `$${(data.mrr / totalShops).toFixed(0)}` : "$0",
            icon: TrendingUp,
            iconBg: "bg-[#FEF3C7]",
            iconColor: "text-[#F59E0B]",
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Plan Distribution */}
        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0]">
            <h2 className="text-lg font-semibold text-[#0F172A]">Plan Distribution</h2>
          </div>
          <div className="p-6">
            <div className="space-y-6">
              {Object.entries(data.distribution).map(([plan, count]) => {
                const color = planColors[plan.toLowerCase()] ?? "#94A3B8";
                return (
                  <div key={plan}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-sm font-semibold text-[#0F172A] capitalize">
                          {plan}
                        </span>
                      </div>
                      <div className="flex items-center gap-8">
                        <div className="text-right">
                          <div className="text-sm font-semibold text-[#0F172A]">{count}</div>
                          <div className="text-xs text-[#64748B]">shops</div>
                        </div>
                      </div>
                    </div>
                    <div className="h-3 bg-[#F1F5F9] rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-500 rounded-full"
                        style={{
                          width: `${totalShops > 0 ? (count / totalShops) * 100 : 0}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                    <div className="text-xs text-[#64748B] mt-1">
                      {totalShops > 0 ? ((count / totalShops) * 100).toFixed(1) : 0}% of shops
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Revenue Summary */}
        <div className="bg-white border border-[#E2E8F0] rounded-lg">
          <div className="px-6 py-4 border-b border-[#E2E8F0]">
            <h2 className="text-lg font-semibold text-[#0F172A]">Revenue Summary</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
              <span className="text-sm text-[#64748B]">Current MRR</span>
              <span className="text-lg font-bold text-[#0F172A]">${data.mrr.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
              <span className="text-sm text-[#64748B]">Total Shops</span>
              <span className="text-lg font-bold text-[#0F172A]">{totalShops}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-[#F8FAFC] rounded-lg">
              <span className="text-sm text-[#64748B]">ARPS</span>
              <span className="text-lg font-bold text-[#0F172A]">
                ${totalShops > 0 ? (data.mrr / totalShops).toFixed(2) : "0.00"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Per-Shop Usage */}
      <AdminTable
        headers={["Shop", "Plan", "Packs Used", "Usage"]}
        isEmpty={data.perShop.length === 0}
        emptyTitle="No usage data"
        emptyMessage="No shops have active pack usage this month"
      >
        {data.perShop.map((s) => {
          const pct = s.limit > 0 ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0;
          return (
            <tr key={s.shop_id} className="hover:bg-[#F8FAFC] transition-colors">
              <td className="px-6 py-4">
                <span className="text-sm font-medium text-[#0F172A]">{s.domain}</span>
              </td>
              <td className="px-6 py-4">
                <StatusPill status={s.plan ?? "free"} />
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-[#0F172A] font-semibold">{s.used}</span>
                <span className="text-sm text-[#64748B]">
                  {" "}
                  / {s.limit === Infinity ? "∞" : s.limit}
                </span>
              </td>
              <td className="px-6 py-4 w-40">
                <div className="w-full h-2.5 bg-[#F1F5F9] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 90
                        ? "bg-[#EF4444]"
                        : pct >= 70
                          ? "bg-[#F59E0B]"
                          : "bg-[#22C55E]"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </div>
  );
}

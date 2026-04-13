"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Store, ExternalLink, Calendar } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface Shop {
  id: string;
  shop_domain: string;
  plan: string;
  created_at: string;
  uninstalled_at: string | null;
}

export default function AdminShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchShops = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const res = await fetch(`/api/admin/shops?${params}`);
    const data = await res.json();
    setShops(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    fetchShops();
  }, [fetchShops]);

  const filtered = shops.filter((s) => {
    if (planFilter !== "all" && (s.plan ?? "free") !== planFilter) return false;
    return true;
  });

  const active = shops.filter((s) => !s.uninstalled_at).length;
  const uninstalled = shops.filter((s) => s.uninstalled_at).length;

  const planColors: Record<string, { bg: string; text: string }> = {
    enterprise: { bg: "bg-[#EDE9FE]", text: "text-[#6B21A8]" },
    scale: { bg: "bg-[#EDE9FE]", text: "text-[#6B21A8]" },
    professional: { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
    growth: { bg: "bg-[#DBEAFE]", text: "text-[#1E40AF]" },
    starter: { bg: "bg-[#D1FAE5]", text: "text-[#065F46]" },
    trial: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
    free: { bg: "bg-[#F1F5F9]", text: "text-[#475569]" },
  };

  return (
    <div className="p-8">
      <AdminPageHeader title="Shops" subtitle="Manage and monitor DisputeDesk installations" />

      <AdminStatsRow
        cards={[
          { label: "Total Shops", value: shops.length },
          { label: "Active", value: active, valueColor: "text-[#22C55E]" },
          { label: "Uninstalled", value: uninstalled, valueColor: "text-[#EF4444]" },
        ]}
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by domain..."
        filters={[
          { label: "All Plans", value: "all" },
          { label: "Enterprise", value: "enterprise" },
          { label: "Growth", value: "growth" },
          { label: "Starter", value: "starter" },
          { label: "Trial", value: "trial" },
        ]}
        activeFilter={planFilter}
        onFilterChange={setPlanFilter}
      />

      <AdminTable
        headers={["Shop Domain", "Plan", "Status", "Installed", "Actions"]}
        headerAlign={{ 4: "right" }}
        loading={loading}
        isEmpty={!loading && filtered.length === 0}
        emptyTitle="No shops found"
        emptyMessage="Try adjusting your search or plan filter"
      >
        {filtered.map((s) => {
          const plan = (s.plan ?? "free").toLowerCase();
          const _pc = planColors[plan];
          return (
            <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-[#64748B]" />
                  <span className="text-sm font-medium text-[#0F172A]">{s.shop_domain}</span>
                </div>
              </td>
              <td className="px-6 py-4">
                <StatusPill status={plan} colorMap={planColors} />
              </td>
              <td className="px-6 py-4">
                <StatusPill status={s.uninstalled_at ? "uninstalled" : "active"} />
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#64748B]" />
                  <span className="text-sm text-[#64748B]">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                <Link
                  href={`/admin/shops/${s.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Details
                </Link>
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </div>
  );
}

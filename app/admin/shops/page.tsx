"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Store, ExternalLink, Calendar } from "lucide-react";
import { ViewAsMerchant } from "@/components/admin/ViewAsMerchant";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable, type AdminTableHeader } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";
import { displayShopDomain } from "@/lib/shopify/domainHost";
import { DeleteShopButton } from "@/components/admin/DeleteShopButton";

interface Shop {
  id: string;
  /** The myshopify alias — `6a8848-dd.myshopify.com`. Always present. */
  shop_domain: string;
  /** The real storefront domain from Shopify's `Shop.primaryDomain`. Null for
   *  shops installed before the backfill, or when enrichment failed. */
  primary_domain: string | null;
  plan: string;
  created_at: string;
  uninstalled_at: string | null;
  /** Computed by the API from `shop_daily_metrics` over the trailing
   *  90 UTC days. Null when the shop has no snapshot rows yet
   *  (fresh install, mid-backfill) or when the window denominator is
   *  zero. */
  chargebackRate90d: number | null;
  chargebackRate90dNumerator: number;
  chargebackRate90dDenominator: number;
  chargebackRate90dAvailable: boolean;
  disputeCount: number;
  packCount: number;
  monthlyRevenueUsd: number;
}

type SortDirection = "asc" | "desc";

function chargebackTone(rate: number | null): "green" | "amber" | "red" | null {
  if (rate === null) return null;
  if (rate < 0.6) return "green";
  if (rate <= 0.9) return "amber";
  return "red";
}

const TONE_TEXT: Record<"green" | "amber" | "red", string> = {
  green: "text-[#15803D]",
  amber: "text-[#B45309]",
  red: "text-[#B91C1C]",
};

export default function AdminShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  /** Sort state for the chargeback rate column. Null = default API
   *  order (created_at desc). Click toggles desc → asc → null. */
  const [chargebackSort, setChargebackSort] = useState<SortDirection | null>(null);

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

  // Client-side sort by chargeback rate (90d). Nulls always at the
  // bottom regardless of direction so "Calculating…" rows don't crowd
  // the top of a "highest rate first" view. Two-state cycle (asc ⇄
  // desc) per Figma `shops-admin.tsx:42-49` — clicking with no sort
  // active starts at desc.
  const sorted = useMemo(() => {
    if (!chargebackSort) return filtered;
    const dir = chargebackSort === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const ar = a.chargebackRate90d;
      const br = b.chargebackRate90d;
      if (ar === null && br === null) return 0;
      if (ar === null) return 1;
      if (br === null) return -1;
      return (ar - br) * dir;
    });
  }, [filtered, chargebackSort]);

  const cycleChargebackSort = () => {
    setChargebackSort((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  const active = shops.filter((s) => !s.uninstalled_at).length;
  const totalDisputes = shops.reduce((s, shop) => s + (shop.disputeCount ?? 0), 0);
  const totalMrr = shops
    .filter((s) => !s.uninstalled_at)
    .reduce((s, shop) => s + (shop.monthlyRevenueUsd ?? 0), 0);

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
          { label: "Total Disputes", value: totalDisputes },
          { label: "Total MRR", value: `$${totalMrr.toLocaleString()}` },
        ]}
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by domain..."
        filters={[
          { label: "All Plans", value: "all" },
          { label: "Scale", value: "scale" },
          { label: "Growth", value: "growth" },
          { label: "Starter", value: "starter" },
          { label: "Free", value: "free" },
        ]}
        activeFilter={planFilter}
        onFilterChange={setPlanFilter}
      />

      <AdminTable
        headers={[
          "Shop Domain",
          "Plan",
          "Status",
          "Disputes",
          "Packs",
          "MRR",
          {
            label: "Chargeback rate (90d)",
            sortable: true,
            sortDirection: chargebackSort,
            onSort: cycleChargebackSort,
          },
          "Installed",
          { label: "Actions", align: "right" },
        ] as AdminTableHeader[]}
        loading={loading}
        isEmpty={!loading && sorted.length === 0}
        emptyTitle="No shops found"
        emptyMessage="Try adjusting your search or plan filter"
      >
        {sorted.map((s) => {
          const plan = (s.plan ?? "free").toLowerCase();
          const _pc = planColors[plan];
          const tone = chargebackTone(s.chargebackRate90d);
          return (
            <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
              <td className="px-6 py-4">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-[#64748B] shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-[#0F172A]">
                      {displayShopDomain(s)}
                    </span>
                    {/* Keep the alias visible when it differs — it is the key
                        every Shopify-side lookup (Partners, Admin URLs, our
                        own logs) is still addressed by. */}
                    {displayShopDomain(s) !== s.shop_domain && (
                      <span className="text-xs text-[#94A3B8]">{s.shop_domain}</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-6 py-4">
                <StatusPill status={plan} colorMap={planColors} />
              </td>
              <td className="px-6 py-4">
                <StatusPill status={s.uninstalled_at ? "uninstalled" : "active"} />
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-[#0F172A] font-semibold">{s.disputeCount}</span>
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-[#0F172A] font-semibold">{s.packCount}</span>
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-[#0F172A] font-semibold">
                  ${s.monthlyRevenueUsd}
                </span>
              </td>
              <td className="px-6 py-4">
                {s.chargebackRate90dAvailable && s.chargebackRate90d !== null ? (
                  <div className="flex flex-col">
                    <span
                      className={`text-sm font-semibold ${tone ? TONE_TEXT[tone] : "text-[#0F172A]"}`}
                    >
                      {s.chargebackRate90d.toFixed(1)}%
                    </span>
                    <span className="text-xs text-[#94A3B8]">
                      {s.chargebackRate90dNumerator} / {s.chargebackRate90dDenominator}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-[#94A3B8]">—</span>
                )}
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
                <div className="flex items-center justify-end gap-2">
                  <ViewAsMerchant shopId={s.id} />
                  <Link
                    href={`/admin/shops/${s.id}`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View Details
                  </Link>
                  <DeleteShopButton
                    shopId={s.id}
                    shopDomain={s.shop_domain}
                    displayName={displayShopDomain(s)}
                    disputeCount={s.disputeCount}
                    packCount={s.packCount}
                    onDeleted={fetchShops}
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

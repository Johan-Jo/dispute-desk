"use client";

/**
 * Admin shop detail page — Figma-aligned 2026-05-01.
 *
 * Header rewrite (Figma `pages/admin/shop-detail.tsx:120-167`):
 * 48×48 Store icon, h1 domain, plan + status pills, Calendar +
 * "Installed" line, right-side "View in Shopify" + "Contact Shop"
 * buttons. AdminPageHeader / AdminStatsRow are not used here; the
 * Risk profile section + Quick Stats footer carry the numbers.
 */

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Store,
  AlertCircle,
  DollarSign,
  Package,
} from "lucide-react";
import { ShopRiskProfile } from "@/components/admin/ShopRiskProfile";

interface ShopDetail {
  shop: {
    id: string;
    shop_domain: string;
    plan: string;
    created_at: string;
    uninstalled_at: string | null;
    pack_limit_override: number | null;
    auto_pack_enabled: boolean | null;
    admin_notes: string | null;
    retention_days: number | null;
  };
  disputes: number;
  packs: number;
  storeRevenue?: { total: number; currency: string; orderCount: number };
}

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

const PLAN_PILL: Record<string, string> = {
  free: "bg-[#F1F5F9] text-[#475569]",
  starter: "bg-[#D1FAE5] text-[#065F46]",
  growth: "bg-[#DBEAFE] text-[#1E40AF]",
  scale: "bg-[#EDE9FE] text-[#6B21A8]",
};

/** Format a store-revenue amount in its own currency (no decimals). */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export default function AdminShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ShopDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [overridePlan, setOverridePlan] = useState("");
  const [overridePackLimit, setOverridePackLimit] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    fetch(`/api/admin/shops/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setOverridePlan(d.shop?.plan ?? "free");
        setOverridePackLimit(d.shop?.pack_limit_override?.toString() ?? "");
        setNotes(d.shop?.admin_notes ?? "");
      });
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/admin/shops/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: overridePlan,
        pack_limit_override: overridePackLimit ? parseInt(overridePackLimit) : null,
        admin_notes: notes || null,
      }),
    });
    setSaving(false);
  };

  if (!data) {
    return (
      <div className="p-8">
        <div className="text-[#64748B] py-12 text-center">Loading...</div>
      </div>
    );
  }

  const { shop, disputes, packs, storeRevenue } = data;
  const planKey = (shop.plan ?? "free").toLowerCase();
  const planLabel = PLAN_LABEL[planKey] ?? planKey;
  const planPillClass = PLAN_PILL[planKey] ?? PLAN_PILL.free;
  const isActive = !shop.uninstalled_at;
  const shopAdminUrl = `https://${shop.shop_domain}/admin`;

  return (
    <div className="p-8">
      {/* Header — Figma `shop-detail.tsx:120-167`. Custom layout
          with Store icon, h1 domain, pills, install date, and right-
          side action buttons. Replaces AdminPageHeader. */}
      <div className="mb-6">
        <Link
          href="/admin/shops"
          className="inline-flex items-center gap-2 text-sm text-[#64748B] hover:text-[#0F172A] mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Shops
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
              <Store className="w-6 h-6 text-[#1D4ED8]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#0F172A] mb-1">{shop.shop_domain}</h1>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`px-2.5 py-1 ${planPillClass} text-xs font-semibold rounded-full`}
                >
                  {planLabel}
                </span>
                <span
                  className={`px-2.5 py-1 ${
                    isActive
                      ? "bg-[#D1FAE5] text-[#065F46]"
                      : "bg-[#FEE2E2] text-[#991B1B]"
                  } text-xs font-semibold rounded-full`}
                >
                  {isActive ? "Active" : "Uninstalled"}
                </span>
                <div className="flex items-center gap-1.5 text-sm text-[#64748B]">
                  <Calendar className="w-3.5 h-3.5" />
                  Installed {new Date(shop.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <a
              href={shopAdminUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 border border-[#E2E8F0] bg-white text-[#0F172A] text-sm font-semibold rounded-lg hover:bg-[#F8FAFC] transition-colors"
            >
              View in Shopify
            </a>
            {/* "Contact Shop" — placeholder until we wire a contact-
                support flow. The button stays visible so the layout
                matches Figma; clicking it currently does nothing. */}
            <button
              type="button"
              disabled
              className="px-4 py-2 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Contact flow coming soon"
            >
              Contact Shop
            </button>
          </div>
        </div>
      </div>

      <ShopRiskProfile shopId={shop.id} />

      {/* Quick Stats footer — Figma `shop-detail.tsx:418-449` */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <DollarSign className="w-5 h-5 text-[#64748B]" />
            <div className="text-sm text-[#64748B]">Monthly Revenue</div>
          </div>
          {storeRevenue ? (
            <>
              <div className="text-2xl font-bold text-[#0F172A]">
                {formatMoney(storeRevenue.total, storeRevenue.currency)}
              </div>
              <div className="text-xs text-[#94A3B8] mt-1">
                {storeRevenue.orderCount.toLocaleString()} orders · last 30 days
              </div>
            </>
          ) : (
            <div className="text-2xl font-bold text-[#94A3B8]">—</div>
          )}
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <Package className="w-5 h-5 text-[#64748B]" />
            <div className="text-sm text-[#64748B]">Evidence Packs</div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{packs}</div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle className="w-5 h-5 text-[#64748B]" />
            <div className="text-sm text-[#64748B]">Total Disputes</div>
          </div>
          <div className="text-2xl font-bold text-[#0F172A]">{disputes}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E2E8F0] p-6">
        <h3 className="text-lg font-semibold text-[#0F172A] mb-4">Admin Overrides</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#64748B] mb-1">Plan Override</label>
            <select
              value={overridePlan}
              onChange={(e) => setOverridePlan(e.target.value)}
              className="py-2.5 px-4 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            >
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="scale">Scale</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#64748B] mb-1">
              Pack Limit Override (blank = plan default)
            </label>
            <input
              type="number"
              value={overridePackLimit}
              onChange={(e) => setOverridePackLimit(e.target.value)}
              placeholder="Plan default"
              className="w-48 py-2.5 px-4 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#64748B] mb-1">Admin Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-[#1D4ED8] text-white text-sm font-semibold rounded-lg hover:bg-[#1E40AF] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Overrides"}
          </button>
        </div>
      </div>
    </div>
  );
}

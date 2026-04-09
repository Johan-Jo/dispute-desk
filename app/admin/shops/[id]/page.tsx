"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { Store, ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { StatusPill } from "@/components/admin/StatusPill";

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

  const { shop, disputes, packs } = data;

  return (
    <div className="p-8 max-w-4xl">
      <Link
        href="/admin/shops"
        className="inline-flex items-center gap-2 text-sm text-[#64748B] hover:text-[#0F172A] mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Shops
      </Link>

      <AdminPageHeader
        title={shop.shop_domain}
        subtitle={`Shop ID: ${shop.id}`}
        icon={Store}
        actions={
          <StatusPill status={shop.uninstalled_at ? "uninstalled" : "active"} />
        }
      />

      <AdminStatsRow
        cards={[
          { label: "Disputes", value: disputes },
          { label: "Evidence Packs", value: packs },
          { label: "Plan", value: (shop.plan ?? "free").charAt(0).toUpperCase() + (shop.plan ?? "free").slice(1) },
          { label: "Installed", value: new Date(shop.created_at).toLocaleDateString() },
        ]}
      />

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

"use client";

import { useState, useEffect, use } from "react";

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
    fetch(`/api/admin/shops/${id}`).then((r) => r.json()).then((d) => {
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
    alert("Saved");
  };

  if (!data) return <div className="text-[#667085] py-12 text-center">Loading...</div>;

  const { shop, disputes, packs } = data;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-[#0B1220] mb-1">{shop.shop_domain}</h1>
      <p className="text-sm text-[#667085] mb-6">Shop ID: {shop.id}</p>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Stat label="Disputes" value={disputes} />
        <Stat label="Packs" value={packs} />
        <Stat label="Plan" value={shop.plan ?? "free"} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <Stat label="Installed" value={new Date(shop.created_at).toLocaleDateString()} />
        <Stat label="Status" value={shop.uninstalled_at ? "Uninstalled" : "Active"} />
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
        <h3 className="font-semibold text-[#0B1220] mb-4">Admin Overrides</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#667085] mb-1">Plan Override</label>
            <select value={overridePlan} onChange={(e) => setOverridePlan(e.target.value)} className="h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm">
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#667085] mb-1">Pack Limit Override (blank = plan default)</label>
            <input
              type="number"
              value={overridePackLimit}
              onChange={(e) => setOverridePackLimit(e.target.value)}
              placeholder="Plan default"
              className="w-48 h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#667085] mb-1">Admin Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm"
            />
          </div>

          <button onClick={handleSave} disabled={saving} className="h-10 px-6 bg-[#0B1220] text-white text-sm font-medium rounded-lg hover:bg-[#1E293B] disabled:opacity-50">
            {saving ? "Saving..." : "Save Overrides"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
      <p className="text-sm text-[#667085]">{label}</p>
      <p className="text-lg font-bold text-[#0B1220] capitalize">{value}</p>
    </div>
  );
}

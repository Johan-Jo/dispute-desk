"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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

  useEffect(() => { fetchShops(); }, [fetchShops]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#0B1220] mb-6">Shops</h1>

      <input
        type="text"
        placeholder="Search by domain..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm h-10 px-3 border border-[#E5E7EB] rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
      />

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F7F8FA]">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Domain</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Installed</th>
              <th className="text-left px-4 py-3 font-medium text-[#667085]">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[#667085]">Loading...</td></tr>
            ) : shops.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[#667085]">No shops found</td></tr>
            ) : shops.map((s) => (
              <tr key={s.id} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA]">
                <td className="px-4 py-3">
                  <Link href={`/admin/shops/${s.id}`} className="font-medium text-[#1D4ED8] hover:underline">
                    {s.shop_domain}
                  </Link>
                </td>
                <td className="px-4 py-3 capitalize">{s.plan ?? "free"}</td>
                <td className="px-4 py-3 text-[#667085]">
                  {new Date(s.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {s.uninstalled_at ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#DC2626]">Uninstalled</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#059669]">Active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

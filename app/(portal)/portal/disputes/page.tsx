"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Filter, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
  needs_review: boolean;
  last_synced_at: string | null;
}

function statusBadge(status: string | null) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "info" | "default"; label: string }> = {
    saved_to_shopify: { variant: "success", label: "Saved to Shopify" },
    needs_response: { variant: "warning", label: "Needs Response" },
    needs_review: { variant: "warning", label: "Needs Review" },
    under_review: { variant: "info", label: "Under Review" },
    building: { variant: "info", label: "Building..." },
    blocked: { variant: "danger", label: "Blocked" },
    ready: { variant: "info", label: "Ready to Save" },
    won: { variant: "success", label: "Won" },
    lost: { variant: "danger", label: "Lost" },
  };
  const cfg = map[status ?? ""] ?? { variant: "default" as const, label: status ?? "Unknown" };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "review">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  // Read active shop from cookie
  const shopId = typeof window !== "undefined"
    ? document.cookie.match(/active_shop_id=([^;]+)/)?.[1] ?? ""
    : "";

  const fetchDisputes = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const params = new URLSearchParams({
      shop_id: shopId,
      page: String(page),
      per_page: "25",
    });
    if (tab === "review") params.set("needs_review", "true");
    const res = await fetch(`/api/disputes?${params}`);
    const json = await res.json();
    setDisputes(json.disputes ?? []);
    setTotalPages(json.pagination?.total_pages ?? 0);
    setLoading(false);
  }, [shopId, page, tab]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const handleSync = async () => {
    if (!shopId) return;
    setSyncing(true);
    await fetch("/api/disputes/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId }),
    });
    await fetchDisputes();
    setSyncing(false);
  };

  const filtered = search
    ? disputes.filter(
        (d) =>
          d.reason?.toLowerCase().includes(search.toLowerCase()) ||
          d.dispute_gid.toLowerCase().includes(search.toLowerCase())
      )
    : disputes;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">Disputes</h1>
          <p className="text-sm text-[#667085]">Manage and respond to chargebacks</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync Now"}
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Button
          variant={tab === "all" ? "primary" : "secondary"}
          size="sm"
          onClick={() => { setTab("all"); setPage(1); }}
        >
          All Disputes
        </Button>
        <Button
          variant={tab === "review" ? "primary" : "secondary"}
          size="sm"
          onClick={() => { setTab("review"); setPage(1); }}
        >
          Review Queue
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-[50%] -translate-y-[50%] text-[#64748B]" />
          <input
            type="text"
            placeholder="Search disputes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-3 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
          />
        </div>
        <Button variant="secondary" size="sm">
          <Filter className="w-4 h-4 mr-1" />
          Filter
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F8FA]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">ID</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Order</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Reason</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Deadline</th>
                <th className="text-left px-4 py-3 font-medium text-[#667085]">Last Synced</th>
                {tab === "review" && (
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#667085]">
                    Loading disputes...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#667085]">
                    {shopId
                      ? "No disputes found. Click Sync Now to fetch from Shopify."
                      : "Connect a Shopify store to see disputes."}
                  </td>
                </tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id} className="border-t border-[#E5E7EB] hover:bg-[#F7F8FA] transition-colors">
                    <td className="px-4 py-3">
                      <a href={`/portal/disputes/${d.id}`} className="font-medium text-[#1D4ED8] hover:underline">
                        {d.dispute_gid.split("/").pop()?.slice(0, 8) ?? d.id.slice(0, 8)}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-[#667085]">
                      {d.order_gid ? `#${d.order_gid.split("/").pop()}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#0B1220]">
                      {formatCurrency(d.amount, d.currency_code)}
                    </td>
                    <td className="px-4 py-3 text-[#667085]">{d.reason ?? "Unknown"}</td>
                    <td className="px-4 py-3">{statusBadge(d.status)}</td>
                    <td className="px-4 py-3 text-[#667085]">{formatDate(d.due_at)}</td>
                    <td className="px-4 py-3 text-[#667085]">{formatDate(d.last_synced_at)}</td>
                    {tab === "review" && (
                      <td className="px-4 py-3">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={async (e) => {
                            e.preventDefault();
                            await fetch(`/api/disputes/${d.id}/approve`, { method: "POST" });
                            await fetchDisputes();
                          }}
                        >
                          Approve
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 p-3 border-t border-[#E5E7EB]">
            <Button variant="ghost" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
              Previous
            </Button>
            <span className="text-sm text-[#667085]">Page {page} of {totalPages}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

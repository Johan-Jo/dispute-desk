"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  MessageSquare,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

interface Dispute {
  id: string;
  shop_id: string;
  shop_domain: string | null;
  order_name: string | null;
  reason: string | null;
  phase: string | null;
  amount: number | null;
  currency_code: string | null;
  normalized_status: string | null;
  submission_state: string | null;
  final_outcome: string | null;
  needs_attention: boolean;
  has_admin_override: boolean;
  overridden_fields: Record<string, boolean> | null;
  sync_health: string | null;
  last_event_at: string | null;
  note_count: number;
}

const STATUS_COLORS: Record<string, string> = {
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  new: "bg-blue-100 text-blue-800",
  in_progress: "bg-blue-100 text-blue-800",
  needs_review: "bg-amber-100 text-amber-800",
  ready_to_submit: "bg-amber-100 text-amber-800",
  action_needed: "bg-orange-100 text-orange-800",
  submitted: "bg-indigo-100 text-indigo-800",
  submitted_to_shopify: "bg-indigo-100 text-indigo-800",
  waiting_on_issuer: "bg-indigo-100 text-indigo-800",
  submitted_to_bank: "bg-indigo-100 text-indigo-800",
  accepted_not_contested: "bg-green-100 text-green-800",
  closed_other: "bg-gray-100 text-gray-800",
};

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [filter, setFilter] = useState<string>("");

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "50" });
      if (filter === "needs_attention") params.set("needs_attention", "true");
      if (filter === "has_override") params.set("has_admin_override", "true");
      const res = await fetch(`/api/admin/disputes?${params}`);
      const data = await res.json();
      setDisputes(data.disputes ?? []);
      setTotalPages(data.pagination?.total_pages ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Disputes</h1>
          <p className="text-sm text-[#64748B]">Cross-shop dispute management</p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4">
        {[
          { key: "", label: "All" },
          { key: "needs_attention", label: "Needs Attention" },
          { key: "has_override", label: "Overridden" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.key
                ? "bg-[#1D4ED8] text-white"
                : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[#64748B]">Loading...</div>
        ) : disputes.length === 0 ? (
          <div className="p-12 text-center text-[#64748B]">No disputes found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B]">Shop</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B]">Order</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B]">Reason</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B]">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B]">Outcome</th>
                  <th className="px-4 py-3 text-right font-semibold text-[#64748B]">Amount</th>
                  <th className="px-4 py-3 text-center font-semibold text-[#64748B]">Indicators</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B]">Last Event</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {disputes.map((d) => (
                  <tr key={d.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                    <td className="px-4 py-3 text-[#0F172A] font-medium truncate max-w-[160px]">
                      {d.shop_domain ?? d.shop_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-[#0F172A]">{d.order_name ?? "—"}</td>
                    <td className="px-4 py-3 text-[#64748B]">
                      {d.reason?.replace(/_/g, " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.normalized_status ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                        {d.normalized_status?.replace(/_/g, " ") ?? d.phase ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {d.final_outcome ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          d.final_outcome === "won" ? "bg-green-100 text-green-800" :
                          d.final_outcome === "lost" ? "bg-red-100 text-red-800" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {d.final_outcome}
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[#0F172A]">
                      {d.amount != null
                        ? new Intl.NumberFormat("en-US", { style: "currency", currency: d.currency_code ?? "USD" }).format(d.amount)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {d.has_admin_override && (
                          <span title={`Override: ${Object.keys(d.overridden_fields ?? {}).join(", ")}`}>
                            <Shield className="w-4 h-4 text-purple-500" />
                          </span>
                        )}
                        {d.note_count > 0 && (
                          <span title={`${d.note_count} note(s)`}>
                            <MessageSquare className="w-4 h-4 text-blue-500" />
                          </span>
                        )}
                        {(d.needs_attention || d.sync_health !== "ok") && (
                          <span title={d.sync_health !== "ok" ? "Sync issue" : "Needs attention"}>
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#94A3B8] text-xs">
                      {d.last_event_at
                        ? new Date(d.last_event_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/disputes/${d.id}`}
                        className="text-[#1D4ED8] hover:underline flex items-center gap-1 text-xs"
                      >
                        Detail <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded bg-[#F1F5F9] text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm text-[#64748B]">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded bg-[#F1F5F9] text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

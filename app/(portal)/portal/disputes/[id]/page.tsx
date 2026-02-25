"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw, FileText, Clock, AlertTriangle, CheckCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";

interface Dispute {
  id: string;
  dispute_gid: string;
  dispute_evidence_gid: string | null;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  initiated_at: string | null;
  due_at: string | null;
  last_synced_at: string | null;
}

interface Pack {
  id: string;
  status: string;
  completeness_score: number | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  saved_to_shopify_at: string | null;
  created_at: string;
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: "—", urgent: false };
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, urgent: true };
  if (diff === 0) return { text: "Due today", urgent: true };
  if (diff <= 3) return { text: `${diff}d remaining`, urgent: true };
  return { text: `${diff}d remaining`, urgent: false };
}

function packStatusBadge(status: string) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "info" | "default"; label: string }> = {
    saved_to_shopify: { variant: "success", label: "Saved to Shopify" },
    ready: { variant: "info", label: "Ready to Save" },
    blocked: { variant: "danger", label: "Blocked" },
    building: { variant: "info", label: "Building..." },
    queued: { variant: "default", label: "Queued" },
    failed: { variant: "danger", label: "Failed" },
  };
  const cfg = map[status] ?? { variant: "default" as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/disputes/${id}`);
    const json = await res.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/api/disputes/${id}/sync`, { method: "POST" });
    await fetchData();
    setSyncing(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    await fetch(`/api/disputes/${id}/packs`, { method: "POST" });
    await fetchData();
    setGenerating(false);
  };

  const handleApprove = async (packId: string) => {
    await fetch(`/api/packs/${packId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="text-center py-20">
        <p className="text-[#667085]">Dispute not found.</p>
        <a href="/portal/disputes" className="text-[#1D4ED8] hover:underline text-sm mt-2 inline-block">
          Back to disputes
        </a>
      </div>
    );
  }

  const deadline = daysUntil(dispute.due_at);

  return (
    <div>
      <a href="/portal/disputes" className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to disputes
      </a>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">
            Dispute {dispute.dispute_gid.split("/").pop()}
          </h1>
          <p className="text-sm text-[#667085]">{dispute.reason ?? "Unknown reason"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Re-sync"}
          </Button>
          <Button variant="primary" size="sm" onClick={handleGenerate} disabled={generating}>
            <FileText className="w-4 h-4 mr-1" />
            {generating ? "Generating..." : "Generate Pack"}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">Amount</p>
          <p className="text-xl font-bold text-[#0B1220]">
            {formatCurrency(dispute.amount, dispute.currency_code)}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">Status</p>
          <Badge variant={dispute.status === "won" ? "success" : dispute.status === "lost" ? "danger" : "warning"}>
            {(dispute.status ?? "unknown").replace(/_/g, " ")}
          </Badge>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">Due Date</p>
          <p className="text-sm font-medium text-[#0B1220]">{formatDate(dispute.due_at)}</p>
        </div>
        <div className={`bg-white rounded-lg border p-4 ${deadline.urgent ? "border-[#EF4444]" : "border-[#E5E7EB]"}`}>
          <p className="text-xs text-[#667085] mb-1">Time Left</p>
          <div className="flex items-center gap-1">
            {deadline.urgent && <AlertTriangle className="w-4 h-4 text-[#EF4444]" />}
            <p className={`text-sm font-medium ${deadline.urgent ? "text-[#EF4444]" : "text-[#0B1220]"}`}>
              {deadline.text}
            </p>
          </div>
        </div>
      </div>

      {/* Details row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <h3 className="font-semibold text-[#0B1220] mb-3">Details</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[#667085]">Initiated</dt>
              <dd className="text-[#0B1220]">{formatDate(dispute.initiated_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#667085]">Order</dt>
              <dd className="text-[#0B1220]">
                {dispute.order_gid ? `#${dispute.order_gid.split("/").pop()}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#667085]">Evidence GID</dt>
              <dd className="text-[#0B1220] truncate max-w-[200px]">
                {dispute.dispute_evidence_gid ?? "Not available"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#667085]">Last synced</dt>
              <dd className="text-[#0B1220]">{formatDate(dispute.last_synced_at)}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <h3 className="font-semibold text-[#0B1220] mb-3">Automation</h3>
          {packs.length === 0 ? (
            <p className="text-sm text-[#667085]">
              No evidence packs yet. The automation pipeline will generate
              one automatically, or click Generate Pack.
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[#667085]">Latest pack</dt>
                <dd>{packStatusBadge(packs[0].status)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#667085]">Completeness</dt>
                <dd className="text-[#0B1220] font-medium">
                  {packs[0].completeness_score != null ? `${packs[0].completeness_score}%` : "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#667085]">Blockers</dt>
                <dd className="text-[#0B1220]">
                  {packs[0].blockers && packs[0].blockers.length > 0
                    ? `${packs[0].blockers.length} remaining`
                    : "None"}
                </dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      {/* Evidence Packs */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] mb-6">
        <div className="flex items-center justify-between p-4 border-b border-[#E5E7EB]">
          <h3 className="font-semibold text-[#0B1220]">Evidence Packs</h3>
        </div>

        {packs.length === 0 ? (
          <div className="p-8 text-center text-[#667085]">
            No evidence packs yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F7F8FA]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Pack</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Score</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Blockers</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} className="border-t border-[#E5E7EB]">
                    <td className="px-4 py-3">
                      <a href={`/portal/packs/${p.id}`} className="text-[#1D4ED8] hover:underline font-medium">
                        {p.id.slice(0, 8)}
                      </a>
                    </td>
                    <td className="px-4 py-3">{packStatusBadge(p.status)}</td>
                    <td className="px-4 py-3">
                      {p.completeness_score != null ? (
                        <span className={p.completeness_score >= 80 ? "text-[#22C55E]" : p.completeness_score >= 50 ? "text-[#F59E0B]" : "text-[#EF4444]"}>
                          {p.completeness_score}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-[#667085]">
                      {p.blockers && p.blockers.length > 0
                        ? p.blockers.join(", ")
                        : "None"}
                    </td>
                    <td className="px-4 py-3 text-[#667085]">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3">
                      {p.status === "ready" && (
                        <Button variant="primary" size="sm" onClick={() => handleApprove(p.id)}>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Approve &amp; Save
                        </Button>
                      )}
                      {p.status === "saved_to_shopify" && p.saved_to_shopify_at && (
                        <span className="text-xs text-[#22C55E]">Saved {formatDate(p.saved_to_shopify_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InfoBanner variant="info">
        Evidence is saved to Shopify via API. Submission to the card network
        happens in Shopify Admin, or Shopify auto-submits on the due date.
      </InfoBanner>
    </div>
  );
}

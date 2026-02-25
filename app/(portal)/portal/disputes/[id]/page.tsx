"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, RefreshCw, FileText, Clock, AlertTriangle, CheckCircle, User, MapPin, Package, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";
import { useDemoMode } from "@/lib/demo-mode";

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

const DEMO_DISPUTES: Record<string, {
  dispute: Dispute;
  customer: { name: string; email: string; phone: string; address: string };
  order: { id: string; date: string; items: string; shipping: string; tracking: string };
  timeline: { date: string; event: string; detail: string }[];
}> = {
  "DP-2401": {
    dispute: {
      id: "DP-2401", dispute_gid: "DP-2401", dispute_evidence_gid: "EV-2401", order_gid: "#1234",
      status: "needs_response", reason: "Fraudulent", amount: 145.00, currency_code: "USD",
      initiated_at: "2026-02-20", due_at: "2026-03-05", last_synced_at: "2026-02-24",
    },
    customer: { name: "John Smith", email: "john.smith@example.com", phone: "+1 (555) 123-4567", address: "123 Main St, New York, NY 10001" },
    order: { id: "#1234", date: "2026-02-15", items: "Premium Wireless Headphones x1", shipping: "USPS Priority Mail", tracking: "9400111899223456789012" },
    timeline: [
      { date: "Feb 20, 2026", event: "Dispute Created", detail: "Chargeback initiated by cardholder's bank" },
      { date: "Feb 20, 2026", event: "Evidence Pack Generated", detail: "Automatic evidence pack created (85% complete)" },
      { date: "Feb 21, 2026", event: "Tracking Added", detail: "Delivery confirmation added to evidence" },
      { date: "Feb 24, 2026", event: "Last Sync", detail: "Data synced from Shopify" },
    ],
  },
  "DP-2402": {
    dispute: {
      id: "DP-2402", dispute_gid: "DP-2402", dispute_evidence_gid: null, order_gid: "#1235",
      status: "under_review", reason: "Product Not Received", amount: 89.50, currency_code: "USD",
      initiated_at: "2026-02-21", due_at: "2026-03-06", last_synced_at: "2026-02-24",
    },
    customer: { name: "Sarah Johnson", email: "sarah.j@example.com", phone: "+1 (555) 234-5678", address: "456 Oak Ave, Los Angeles, CA 90001" },
    order: { id: "#1235", date: "2026-02-10", items: "Organic Skincare Set x1", shipping: "FedEx Ground", tracking: "7489102948573920184" },
    timeline: [
      { date: "Feb 21, 2026", event: "Dispute Created", detail: "Customer claims product not received" },
      { date: "Feb 22, 2026", event: "Under Review", detail: "Evidence being reviewed by team" },
    ],
  },
  "DP-2403": {
    dispute: {
      id: "DP-2403", dispute_gid: "DP-2403", dispute_evidence_gid: null, order_gid: "#1236",
      status: "needs_response", reason: "Product Unacceptable", amount: 234.00, currency_code: "USD",
      initiated_at: "2026-02-22", due_at: "2026-03-07", last_synced_at: "2026-02-24",
    },
    customer: { name: "Mike Davis", email: "mike.d@example.com", phone: "+1 (555) 345-6789", address: "789 Elm St, Chicago, IL 60601" },
    order: { id: "#1236", date: "2026-02-12", items: "Smart Watch Pro x1", shipping: "UPS 2-Day", tracking: "1Z999AA10123456784" },
    timeline: [
      { date: "Feb 22, 2026", event: "Dispute Created", detail: "Customer claims product quality issues" },
    ],
  },
};

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string | null): { key: string; params?: { count: number }; urgent: boolean } | { key: "none"; urgent: false } {
  if (!iso) return { key: "none", urgent: false };
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { key: "daysOverdue", params: { count: Math.abs(diff) }, urgent: true };
  if (diff === 0) return { key: "dueToday", urgent: true };
  return { key: "daysRemaining", params: { count: diff }, urgent: diff <= 3 };
}

const PACK_STATUS_KEYS: Record<string, string> = {
  saved_to_shopify: "savedToShopify",
  ready: "readyToSave",
  blocked: "blocked",
  building: "building",
  queued: "queued",
  failed: "failed",
};

const DISPUTE_STATUS_KEYS: Record<string, string> = {
  needs_response: "needsResponse",
  under_review: "underReview",
  won: "won",
  lost: "lost",
  saved_to_shopify: "savedToShopify",
  needs_review: "needsReview",
  building: "building",
  blocked: "blocked",
  ready: "readyToSave",
  queued: "queued",
  failed: "failed",
};

function packStatusBadge(status: string, tStatus: (key: string) => string) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "info" | "default" }> = {
    saved_to_shopify: { variant: "success" },
    ready: { variant: "info" },
    blocked: { variant: "danger" },
    building: { variant: "info" },
    queued: { variant: "default" },
    failed: { variant: "danger" },
  };
  const cfg = map[status] ?? { variant: "default" as const };
  const label = PACK_STATUS_KEYS[status] ? tStatus(PACK_STATUS_KEYS[status]) : status;
  return <Badge variant={cfg.variant}>{label}</Badge>;
}

function DemoDisputeDetail({ disputeId }: { disputeId: string }) {
  const t = useTranslations("disputes");
  const tStatus = useTranslations("status");
  const tt = useTranslations("table");
  const data = DEMO_DISPUTES[disputeId];

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-[#667085]">{t("disputeNotFoundDemo")}</p>
        <a href="/portal/disputes" className="text-[#1D4ED8] hover:underline text-sm mt-2 inline-block">
          {t("backToDisputes")}
        </a>
      </div>
    );
  }

  const { dispute, customer, order, timeline } = data;
  const deadline = daysUntil(dispute.due_at);
  const deadlineText = deadline.key === "none" ? "—" : "params" in deadline && deadline.params ? t(deadline.key, deadline.params) : t(deadline.key);

  return (
    <div>
      <a href="/portal/disputes" className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] mb-4">
        <ArrowLeft className="w-4 h-4" /> {t("backToDisputes")}
      </a>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">{t("disputeTitle", { id: dispute.dispute_gid })}</h1>
          <p className="text-sm text-[#667085]">{dispute.reason}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">
            <RefreshCw className="w-4 h-4 mr-1" />
            {t("reSync")}
          </Button>
          <Button variant="primary" size="sm">
            <FileText className="w-4 h-4 mr-1" />
            {t("generatePack")}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">{t("amount")}</p>
          <p className="text-xl font-bold text-[#0B1220]">{formatCurrency(dispute.amount, dispute.currency_code)}</p>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">{tt("status")}</p>
          <Badge variant="warning">{tStatus("needsResponse")}</Badge>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">{t("dueDate")}</p>
          <p className="text-sm font-medium text-[#0B1220]">{formatDate(dispute.due_at)}</p>
        </div>
        <div className={`bg-white rounded-lg border p-4 ${deadline.urgent ? "border-[#EF4444]" : "border-[#E5E7EB]"}`}>
          <p className="text-xs text-[#667085] mb-1">{t("timeLeft")}</p>
          <div className="flex items-center gap-1">
            {deadline.urgent && <AlertTriangle className="w-4 h-4 text-[#EF4444]" />}
            <p className={`text-sm font-medium ${deadline.urgent ? "text-[#EF4444]" : "text-[#0B1220]"}`}>{deadlineText}</p>
          </div>
        </div>
      </div>

      {/* Customer + Order details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-4 h-4 text-[#667085]" />
            <h3 className="font-semibold text-[#0B1220]">{t("customerInfo")}</h3>
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-[#667085]">{t("name")}</dt><dd className="text-[#0B1220] font-medium">{customer.name}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("email")}</dt><dd className="text-[#0B1220]">{customer.email}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("phone")}</dt><dd className="text-[#0B1220]">{customer.phone}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("address")}</dt><dd className="text-[#0B1220] text-right max-w-[200px]">{customer.address}</dd></div>
          </dl>
        </div>

        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-4 h-4 text-[#667085]" />
            <h3 className="font-semibold text-[#0B1220]">{t("orderDetails")}</h3>
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-[#667085]">{t("orderId")}</dt><dd className="text-[#0B1220] font-medium">{order.id}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("date")}</dt><dd className="text-[#0B1220]">{order.date}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("items")}</dt><dd className="text-[#0B1220]">{order.items}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("shipping")}</dt><dd className="text-[#0B1220]">{order.shipping}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("tracking")}</dt><dd className="text-[#0B1220] font-mono text-xs">{order.tracking}</dd></div>
          </dl>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-[#667085]" />
          <h3 className="font-semibold text-[#0B1220]">{t("timeline")}</h3>
        </div>
        <div className="space-y-4">
          {timeline.map((item, idx) => (
            <div key={idx} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 bg-[#1D4ED8] rounded-full" />
                {idx < timeline.length - 1 && <div className="w-px flex-1 bg-[#E5E7EB] mt-1" />}
              </div>
              <div className="pb-4">
                <p className="text-xs text-[#667085]">{item.date}</p>
                <p className="text-sm font-medium text-[#0B1220]">{item.event}</p>
                <p className="text-sm text-[#667085]">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <InfoBanner variant="info">
        {t("compliance")}
      </InfoBanner>
    </div>
  );
}

export default function DisputeDetailPage() {
  const t = useTranslations("disputes");
  const tc = useTranslations("common");
  const tt = useTranslations("table");
  const tStatus = useTranslations("status");
  const { id } = useParams<{ id: string }>();
  const isDemo = useDemoMode();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    if (isDemo) { setLoading(false); return; }
    setLoading(true);
    const res = await fetch(`/api/disputes/${id}`);
    const json = await res.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setLoading(false);
  }, [id, isDemo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isDemo) return <DemoDisputeDetail disputeId={id} />;

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
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
        <p className="text-sm text-[#667085]">{tc("loading")}</p>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="text-center py-20">
        <p className="text-[#667085]">{t("disputeNotFound")}</p>
        <a href="/portal/disputes" className="text-[#1D4ED8] hover:underline text-sm mt-2 inline-block">
          {t("backToDisputes")}
        </a>
      </div>
    );
  }

  const deadline = daysUntil(dispute.due_at);
  const deadlineText = deadline.key === "none" ? "—" : "params" in deadline && deadline.params ? t(deadline.key, deadline.params) : t(deadline.key);
  const statusKey = DISPUTE_STATUS_KEYS[dispute.status ?? ""] ?? "unknown";

  return (
    <div>
      <a href="/portal/disputes" className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] mb-4">
        <ArrowLeft className="w-4 h-4" /> {t("backToDisputes")}
      </a>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">
            {t("disputeTitle", { id: dispute.dispute_gid.split("/").pop() ?? id })}
          </h1>
          <p className="text-sm text-[#667085]">{dispute.reason ?? t("unknownReason")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? t("reSyncing") : t("reSync")}
          </Button>
          <Button variant="primary" size="sm" onClick={handleGenerate} disabled={generating}>
            <FileText className="w-4 h-4 mr-1" />
            {generating ? t("generating") : t("generatePack")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">{t("amount")}</p>
          <p className="text-xl font-bold text-[#0B1220]">{formatCurrency(dispute.amount, dispute.currency_code)}</p>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">{tt("status")}</p>
          <Badge variant={dispute.status === "won" ? "success" : dispute.status === "lost" ? "danger" : "warning"}>
            {tStatus(statusKey)}
          </Badge>
        </div>
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <p className="text-xs text-[#667085] mb-1">{t("dueDate")}</p>
          <p className="text-sm font-medium text-[#0B1220]">{formatDate(dispute.due_at)}</p>
        </div>
        <div className={`bg-white rounded-lg border p-4 ${deadline.urgent ? "border-[#EF4444]" : "border-[#E5E7EB]"}`}>
          <p className="text-xs text-[#667085] mb-1">{t("timeLeft")}</p>
          <div className="flex items-center gap-1">
            {deadline.urgent && <AlertTriangle className="w-4 h-4 text-[#EF4444]" />}
            <p className={`text-sm font-medium ${deadline.urgent ? "text-[#EF4444]" : "text-[#0B1220]"}`}>{deadlineText}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <h3 className="font-semibold text-[#0B1220] mb-3">{t("details")}</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-[#667085]">{t("initiated")}</dt><dd className="text-[#0B1220]">{formatDate(dispute.initiated_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("order")}</dt><dd className="text-[#0B1220]">{dispute.order_gid ? `#${dispute.order_gid.split("/").pop()}` : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("evidenceGid")}</dt><dd className="text-[#0B1220] truncate max-w-[200px]">{dispute.dispute_evidence_gid ?? tc("notAvailable")}</dd></div>
            <div className="flex justify-between"><dt className="text-[#667085]">{t("lastSynced")}</dt><dd className="text-[#0B1220]">{formatDate(dispute.last_synced_at)}</dd></div>
          </dl>
        </div>

        <div className="bg-white rounded-lg border border-[#E5E7EB] p-4">
          <h3 className="font-semibold text-[#0B1220] mb-3">{t("automation")}</h3>
          {packs.length === 0 ? (
            <p className="text-sm text-[#667085]">
              {t("noPacksAuto")}
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-[#667085]">{t("latestPack")}</dt><dd>{packStatusBadge(packs[0].status, tStatus)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#667085]">{t("completeness")}</dt><dd className="text-[#0B1220] font-medium">{packs[0].completeness_score != null ? `${packs[0].completeness_score}%` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-[#667085]">{t("blockers")}</dt><dd className="text-[#0B1220]">{packs[0].blockers && packs[0].blockers.length > 0 ? tc("remaining", { count: packs[0].blockers.length }) : tc("none")}</dd></div>
            </dl>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] mb-6">
        <div className="flex items-center justify-between p-4 border-b border-[#E5E7EB]">
          <h3 className="font-semibold text-[#0B1220]">{t("evidencePacks")}</h3>
        </div>
        {packs.length === 0 ? (
          <div className="p-8 text-center text-[#667085]">{t("noPacks")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F7F8FA]">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("pack")}</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("status")}</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("score")}</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">{t("blockers")}</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("created")}</th>
                  <th className="text-left px-4 py-3 font-medium text-[#667085]">{tt("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id} className="border-t border-[#E5E7EB]">
                    <td className="px-4 py-3"><a href={`/portal/packs/${p.id}`} className="text-[#1D4ED8] hover:underline font-medium">{p.id.slice(0, 8)}</a></td>
                    <td className="px-4 py-3">{packStatusBadge(p.status, tStatus)}</td>
                    <td className="px-4 py-3">{p.completeness_score != null ? <span className={p.completeness_score >= 80 ? "text-[#22C55E]" : p.completeness_score >= 50 ? "text-[#F59E0B]" : "text-[#EF4444]"}>{p.completeness_score}%</span> : "—"}</td>
                    <td className="px-4 py-3 text-[#667085]">{p.blockers && p.blockers.length > 0 ? p.blockers.join(", ") : tc("none")}</td>
                    <td className="px-4 py-3 text-[#667085]">{formatDate(p.created_at)}</td>
                    <td className="px-4 py-3">
                      {p.status === "ready" && (
                        <Button variant="primary" size="sm" onClick={() => handleApprove(p.id)}>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {t("approveAndSave")}
                        </Button>
                      )}
                      {p.status === "saved_to_shopify" && p.saved_to_shopify_at && (
                        <span className="text-xs text-[#22C55E]">{t("saved", { date: formatDate(p.saved_to_shopify_at) })}</span>
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
        {t("compliance")}
      </InfoBanner>
    </div>
  );
}

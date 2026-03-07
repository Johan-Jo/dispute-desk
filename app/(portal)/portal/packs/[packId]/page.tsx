"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Upload,
  Clock,
  Shield,
  FileDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";

interface ChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

interface EvidenceItem {
  id: string;
  type: string;
  label: string;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface AuditEvent {
  id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  actor_type: string;
  created_at: string;
}

interface PackData {
  id: string;
  shop_id: string;
  name?: string;
  dispute_id: string | null;
  status: string;
  completeness_score: number | null;
  checklist: ChecklistItem[] | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  pack_json: Record<string, unknown> | null;
  pdf_path: string | null;
  saved_to_shopify_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  evidence_items: EvidenceItem[];
  audit_events: AuditEvent[];
  active_build_job: { id: string; status: string } | null;
  active_pdf_job: { id: string; status: string } | null;
}

function formatDate(iso: string | null, locale: string = "en"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusConfig(status: string, ts: (key: string) => string) {
  const map: Record<string, { variant: "success" | "warning" | "danger" | "info" | "default"; label: string }> = {
    saved_to_shopify: { variant: "success", label: ts("savedToShopify") },
    ready: { variant: "info", label: ts("ready") },
    blocked: { variant: "danger", label: ts("blocked") },
    building: { variant: "info", label: ts("building") },
    queued: { variant: "default", label: ts("queued") },
    failed: { variant: "danger", label: ts("failed") },
    draft: { variant: "default", label: ts("draft") },
  };
  return map[status] ?? { variant: "default" as const, label: status };
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-[#22C55E]";
  if (score >= 50) return "text-[#F59E0B]";
  return "text-[#EF4444]";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-[#22C55E]";
  if (score >= 50) return "bg-[#F59E0B]";
  return "bg-[#EF4444]";
}

export default function PackPreviewPage() {
  const { packId } = useParams<{ packId: string }>();
  const t = useTranslations("packs");
  const ts = useTranslations("status");
  const locale = useLocale();
  const [pack, setPack] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const fetchPack = useCallback(async () => {
    const res = await fetch(`/api/packs/${packId}`);
    if (res.ok) {
      const data = await res.json();
      setPack(data);
      const isActive =
        data.status === "queued" ||
        data.status === "building" ||
        data.active_pdf_job;
      if (!isActive && pollRef.current) clearInterval(pollRef.current);
    }
    setLoading(false);
  }, [packId]);

  useEffect(() => {
    fetchPack();
    pollRef.current = setInterval(fetchPack, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPack]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name);
      await fetch(`/api/packs/${packId}/upload`, { method: "POST", body: form });
    }
    await fetchPack();
    setUploading(false);
    e.target.value = "";
  };

  const handleApprove = async () => {
    await fetch(`/api/packs/${packId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchPack();
  };

  const handleRenderPdf = async () => {
    setRendering(true);
    await fetch(`/api/packs/${packId}/render-pdf`, { method: "POST" });
    pollRef.current = setInterval(fetchPack, 3000);
    await fetchPack();
    setRendering(false);
  };

  const handleDownload = async () => {
    const res = await fetch(`/api/packs/${packId}/download`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="text-center py-20">
        <p className="text-[#667085]">{t("packNotFound")}</p>
        <a href="/portal/packs" className="text-[#1D4ED8] hover:underline text-sm mt-2 inline-block">
          {t("backToDisputes")}
        </a>
      </div>
    );
  }

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;
  const cfg = statusConfig(pack.status, ts);

  const isLibraryPack = pack.dispute_id == null;

  return (
    <div>
      <a
        href={isLibraryPack ? "/portal/packs" : `/portal/disputes/${pack.dispute_id}`}
        className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> {isLibraryPack ? t("backToPacks") : t("backToDispute")}
      </a>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220]">
            {pack.name ?? t("packTitle", { id: pack.id.slice(0, 8) })}
          </h1>
          <p className="text-sm text-[#667085]">
            {t("created", { date: formatDate(pack.created_at, locale), creator: pack.created_by ?? "system" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
          {pack.status === "ready" && (
            <Button variant="primary" size="sm" onClick={handleApprove}>
              <CheckCircle className="w-4 h-4 mr-1" />
              {t("approveAndSave")}
            </Button>
          )}
        </div>
      </div>

      {isBuilding && (
        <div className="mb-4">
          <InfoBanner variant="info">
            {t("building")}
          </InfoBanner>
        </div>
      )}

      {/* Score + Blockers */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-[#0B1220]">{t("completenessScore")}</h3>
          <span className={`text-2xl font-bold ${scoreColor(score)}`}>{score}%</span>
        </div>
        <div className="w-full h-2 bg-[#E5E7EB] rounded-full overflow-hidden mb-4">
          <div
            className={`h-full rounded-full transition-all ${scoreBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>

        {pack.blockers && pack.blockers.length > 0 && (
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-md p-3 mb-3">
            <p className="text-sm font-medium text-[#DC2626]">
              {t("blockersLabel", { count: pack.blockers.length, list: pack.blockers.join(", ") })}
            </p>
          </div>
        )}
        {pack.recommended_actions && pack.recommended_actions.length > 0 && (
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-md p-3">
            <p className="text-sm text-[#92400E]">
              {t("recommended", { list: pack.recommended_actions.join(", ") })}
            </p>
          </div>
        )}
      </div>

      {/* Checklist */}
      {pack.checklist && pack.checklist.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">{t("evidenceChecklist")}</h3>
          <div className="space-y-2">
            {pack.checklist.map((item) => (
              <div key={item.field} className="flex items-center gap-3">
                {item.present ? (
                  <CheckCircle className="w-5 h-5 text-[#22C55E] shrink-0" />
                ) : (
                  <XCircle className={`w-5 h-5 shrink-0 ${item.required ? "text-[#EF4444]" : "text-[#94A3B8]"}`} />
                )}
                <span className="text-sm text-[#0B1220]">{item.label}</span>
                {item.required && !item.present && (
                  <Badge variant="danger">{t("required")}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Sections */}
      {pack.evidence_items.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] mb-6">
          <div className="p-5 border-b border-[#E5E7EB]">
            <h3 className="font-semibold text-[#0B1220]">
              {t("evidenceItems", { count: pack.evidence_items.length })}
            </h3>
          </div>
          {pack.evidence_items.map((item) => (
            <div key={item.id} className="border-b border-[#E5E7EB] last:border-0">
              <button
                onClick={() => toggle(item.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-[#F7F8FA] transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="default">{item.type}</Badge>
                  <span className="text-sm font-medium text-[#0B1220]">{item.label}</span>
                </div>
                {expanded.has(item.id) ? (
                  <ChevronUp className="w-4 h-4 text-[#667085]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#667085]" />
                )}
              </button>
              {expanded.has(item.id) && (
                <div className="px-4 pb-4">
                  <pre className="text-xs bg-[#F7F8FA] rounded-md p-3 overflow-auto max-h-64">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                  <p className="text-xs text-[#667085] mt-2">
                    {t("source", { source: item.source, date: formatDate(item.created_at, locale) })}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* File Upload */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <h3 className="font-semibold text-[#0B1220] mb-2">{t("uploadEvidence")}</h3>
        <p className="text-sm text-[#667085] mb-4">
          {t("uploadPlaceholder")}
        </p>
        <label className="flex items-center justify-center border-2 border-dashed border-[#CBD5E1] rounded-lg p-6 cursor-pointer hover:border-[#1D4ED8] transition-colors">
          <input
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
            onChange={handleUpload}
            disabled={uploading}
          />
          <div className="text-center">
            <Upload className="w-8 h-8 text-[#94A3B8] mx-auto mb-2" />
            <p className="text-sm text-[#667085]">
              {uploading ? t("uploading") : t("clickToUpload")}
            </p>
          </div>
        </label>
      </div>

      {/* Save Evidence to Shopify */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <h3 className="font-semibold text-[#0B1220] mb-3">{t("saveToShopify")}</h3>
        {pack.status === "saved_to_shopify" ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-5 h-5 text-[#22C55E]" />
              <span className="text-sm font-medium text-[#22C55E]">
                {t("saveSuccess")}
              </span>
            </div>
            <a
              href={`https://admin.shopify.com`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#1D4ED8] hover:underline"
            >
              {t("openInShopifyAdmin")}
            </a>
          </div>
        ) : (
          <div>
            <p className="text-sm text-[#667085] mb-3">
              {t("saveDescription")}
            </p>
            <Button
              variant="primary"
              size="sm"
              disabled={saving || pack.status === "saving" || pack.status === "building" || pack.status === "queued"}
              onClick={async () => {
                setSaving(true);
                await fetch(`/api/packs/${packId}/save-to-shopify`, { method: "POST" });
                await fetchPack();
                setSaving(false);
              }}
            >
              {pack.status === "saving" || saving ? t("saving") : t("saveToShopify")}
            </Button>
            {pack.status === "save_failed" && (
              <div className="mt-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-3">
                <p className="text-sm text-[#DC2626]">
                  {t("saveFailed")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Completeness Gate */}
      {pack.completeness_score != null && pack.completeness_score < 60 && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-4 mb-6">
          <h4 className="font-semibold text-[#92400E] mb-1">{t("missingEvidence")}</h4>
          <p className="text-sm text-[#92400E]">
            {t("lowScore", { score: pack.completeness_score })}
          </p>
          {pack.checklist && (
            <ul className="mt-2 text-sm text-[#92400E] list-disc pl-4 space-y-1">
              {(pack.checklist as Array<{ field: string; label: string; required: boolean; present: boolean }>)
                .filter((c) => !c.present && c.required)
                .map((c) => (
                  <li key={c.field}>{c.label} ({t("required")})</li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* PDF Export */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
        <h3 className="font-semibold text-[#0B1220] mb-3">{t("pdfExport")}</h3>
        {pack.active_pdf_job ? (
          <InfoBanner variant="info">
            {t("renderingBanner")}
          </InfoBanner>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRenderPdf}
              disabled={rendering}
            >
              {rendering
                ? t("rendering")
                : pack.pdf_path
                  ? t("reRenderPdf")
                  : t("renderPdf")}
            </Button>
            {pack.pdf_path && (
              <Button variant="primary" size="sm" onClick={handleDownload}>
                {t("downloadPdf")}
              </Button>
            )}
          </div>
        )}
        {pack.pdf_path && (
          <p className="text-xs text-[#667085] mt-2">
            {t("lastRendered", { path: pack.pdf_path.split("/").pop()?.replace(/-/g, ":") ?? "" })}
          </p>
        )}
      </div>

      {/* Audit Log */}
      {pack.audit_events.length > 0 && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 mb-6">
          <h3 className="font-semibold text-[#0B1220] mb-4">{t("auditLog")}</h3>
          <div className="space-y-3">
            {pack.audit_events.map((evt) => (
              <div key={evt.id} className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-[#94A3B8] mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm text-[#0B1220]">
                    {evt.event_type.replace(/_/g, " ")}
                    <span className="text-[#667085]"> ({evt.actor_type})</span>
                  </p>
                  <p className="text-xs text-[#667085]">{formatDate(evt.created_at, locale)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compliance */}
      <InfoBanner variant="info">
        <Shield className="w-4 h-4 mr-2 inline" />
        {t("compliance")}
      </InfoBanner>
    </div>
  );
}

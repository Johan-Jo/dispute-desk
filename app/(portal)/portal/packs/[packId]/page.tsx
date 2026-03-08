"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
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
import {
  StepCard,
  StatusBanner,
  ReadinessMeter,
  TemplateOriginCard,
  SuggestedEvidenceChecklist,
} from "@/components/packs/detail";

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
  dispute_type?: string | null;
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
  source?: string | null;
  template_id?: string | null;
  template_name?: string | null;
  shop_domain?: string | null;
  dispute_gid?: string | null;
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

/** Suggested evidence message keys by dispute type (fallback when no checklist). */
const SUGGESTED_EVIDENCE_KEYS: Record<string, string[]> = {
  FRAUD: ["suggestedOrderConfirmation", "suggestedTracking", "suggestedBillingShipping", "suggestedCustomerComm", "suggestedStorePolicy", "suggestedFraudScreening", "suggestedMetadata"],
  FRAUDULENT: ["suggestedOrderConfirmation", "suggestedTracking", "suggestedBillingShipping", "suggestedCustomerComm", "suggestedStorePolicy", "suggestedFraudScreening", "suggestedMetadata"],
  PNR: ["suggestedOrderConfirmation", "suggestedTracking", "suggestedBillingShipping", "suggestedCustomerComm", "suggestedStorePolicy"],
  PRODUCT_NOT_RECEIVED: ["suggestedOrderConfirmation", "suggestedTracking", "suggestedBillingShipping", "suggestedCustomerComm", "suggestedStorePolicy"],
  NOT_AS_DESCRIBED: ["suggestedOrderConfirmation", "suggestedRefundPolicy", "suggestedCustomerComm", "suggestedStorePolicy"],
  DUPLICATE: ["suggestedOrderConfirmation", "suggestedBillingShipping", "suggestedCustomerComm"],
  SUBSCRIPTION: ["suggestedOrderConfirmation", "suggestedRefundPolicy", "suggestedCustomerComm"],
  REFUND: ["suggestedOrderConfirmation", "suggestedRefundPolicy", "suggestedCustomerComm"],
  GENERAL: ["suggestedOrderConfirmation", "suggestedTracking", "suggestedCustomerComm", "suggestedRefundPolicy", "suggestedStorePolicy"],
};

function getReadinessStateLabel(score: number, t: (key: string) => string): string {
  if (score >= 90) return t("readinessReadyToReview");
  if (score >= 60) return t("readinessNearlyReady");
  if (score >= 25) return t("readinessInProgress");
  return t("readinessJustStarted");
}

function getStatusBanner(
  pack: PackData,
  t: (key: string) => string
): { variant: "draft" | "template" | "saved" | "ready" | "submitted" | "info"; message: string } {
  if (pack.status === "saved_to_shopify")
    return { variant: "saved", message: t("statusSaved") };
  if (pack.status === "ready")
    return { variant: "ready", message: t("statusReady") };
  if (pack.source === "TEMPLATE" && !pack.saved_to_shopify_at)
    return { variant: "template", message: t("statusTemplateDraft") };
  return { variant: "draft", message: t("statusDraft") };
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
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
    setUploadError(null);
    setUploadSuccess(false);
    let ok = true;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name);
      const res = await fetch(`/api/packs/${packId}/upload`, { method: "POST", body: form });
      if (!res.ok) {
        ok = false;
        const data = await res.json().catch(() => ({}));
        setUploadError(data?.error ?? t("uploadFailed"));
        break;
      }
    }
    if (ok) {
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 4000);
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

  const handleExportPdf = async () => {
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
        <Link href="/portal/packs" className="text-[#1D4ED8] hover:underline text-sm mt-2 inline-block">
          {t("backToPacks")}
        </Link>
      </div>
    );
  }

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;
  const cfg = statusConfig(pack.status, ts);
  const isLibraryPack = pack.dispute_id == null;
  const fromTemplate = pack.source === "TEMPLATE" && (pack.template_name ?? pack.name);
  const disputeTypeKey = pack.dispute_type ? pack.dispute_type.toUpperCase().replace(/\s+/g, "_") : "GENERAL";
  const disputeTypeLabel = pack.dispute_type
    ? (t as (key: string) => string)(`disputeTypeLabel.${disputeTypeKey}`) || pack.dispute_type.replace(/_/g, " ")
    : null;
  const suggestedKeys = SUGGESTED_EVIDENCE_KEYS[disputeTypeKey] ?? SUGGESTED_EVIDENCE_KEYS.GENERAL;
  const suggestedLabels = suggestedKeys.map((key) => t(key));
  const statusBanner = getStatusBanner(pack, t);

  return (
    <div>
      <Link
        href={isLibraryPack ? "/portal/packs" : `/portal/disputes/${pack.dispute_id}`}
        className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B1220] mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> {isLibraryPack ? t("backToPacks") : t("backToDispute")}
      </Link>

      {/* A. Hero / Summary */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220] mb-2">
          {t("detailHeroTitle")}
        </h1>
        <p className="text-[#667085] mb-4">{t("detailHeroDescription")}</p>
        <div className="flex flex-wrap gap-4 text-sm text-[#667085] mb-4">
          {pack.name && (
            <span className="font-medium text-[#0B1220]">{pack.name}</span>
          )}
          {disputeTypeLabel && (
            <span><strong className="text-[#0B1220]">{t("detailDisputeType")}</strong> {disputeTypeLabel}</span>
          )}
          <span><strong className="text-[#0B1220]">{t("detailStatus")}</strong> <Badge variant={cfg.variant}>{cfg.label}</Badge></span>
          <span><strong className="text-[#0B1220]">{t("detailCreated")}</strong> {formatDate(pack.created_at, locale)}</span>
        </div>
        <ol className="list-decimal list-inside text-sm text-[#667085] space-y-1">
          <li>{t("detailWorkflow1")}</li>
          <li>{t("detailWorkflow2")}</li>
          <li>{t("detailWorkflow3")}</li>
          <li>{t("detailWorkflow4")}</li>
          <li className="text-[#94A3B8]">{t("detailWorkflowOptional")}</li>
        </ol>
      </div>

      {/* B. Template continuity */}
      {fromTemplate && (
        <TemplateOriginCard
          startedFromTemplateLabel={t("startedFromTemplate")}
          templateName={pack.template_name ?? pack.name ?? ""}
          basedOnLabel={t("basedOnTemplate", { name: pack.template_name ?? pack.name ?? "" })}
          description={t("templateContinuityDescription")}
          browseTemplatesHref="/portal/packs"
          browseTemplatesLabel={t("browseTemplates")}
          templateBadgeLabel={t("templateBadge")}
        />
      )}

      {/* C. Recommended evidence */}
      <SuggestedEvidenceChecklist
        title={t("recommendedForDispute")}
        description={t("recommendedForDisputeDescription")}
        guideLabel={t("useChecklistAsGuide")}
        checklist={pack.checklist}
        suggestedLabels={suggestedLabels}
      />

      {/* D. Readiness */}
      <ReadinessMeter
        score={score}
        label={t("packReadiness")}
        helperText={t("readinessHelper")}
        stateLabel={getReadinessStateLabel(score, t)}
      />

      {pack.blockers && pack.blockers.length > 0 && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-[#DC2626]">
            {t("blockersLabel", { count: pack.blockers.length, list: pack.blockers.join(", ") })}
          </p>
        </div>
      )}

      {isBuilding && (
        <div className="mb-6">
          <StatusBanner variant="info" message={t("building")} />
        </div>
      )}

      {/* E. Step 1 — Upload */}
      <StepCard stepNumber={1} title={t("step1Title")}>
        <p>{t("step1Description")}</p>
        <p className="text-[#94A3B8]">{t("step1FileRestrictions")}</p>
        {fromTemplate && <p className="text-[#1E40AF] font-medium">{t("step1MatchChecklist")}</p>}
      </StepCard>

      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6 ml-0">
        {uploadSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] text-[#065F46] px-4 py-2 text-sm">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            {t("uploadSuccess")}
          </div>
        )}
        {uploadError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-2 text-sm">
            <XCircle className="w-5 h-5 flex-shrink-0" />
            {uploadError}
          </div>
        )}
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#CBD5E1] rounded-lg p-8 cursor-pointer hover:border-[#1D4ED8] transition-colors">
          <input
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
            onChange={handleUpload}
            disabled={uploading}
          />
          <Upload className="w-10 h-10 text-[#94A3B8] mb-3" />
          <p className="text-sm text-[#667085] text-center">
            {uploading ? t("uploading") : pack.evidence_items.length === 0 ? t("step1EmptyState") : t("clickToUpload")}
          </p>
        </label>
      </div>

      {/* Evidence list */}
      {pack.evidence_items.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] mb-6">
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
                {expanded.has(item.id) ? <ChevronUp className="w-4 h-4 text-[#667085]" /> : <ChevronDown className="w-4 h-4 text-[#667085]" />}
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

      {/* F. Step 2 — Save to Shopify */}
      <StepCard stepNumber={2} title={t("step2Title")}>
        <p>{t("step2Description")}</p>
      </StepCard>

      <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6">
        {pack.status === "saved_to_shopify" ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-[#22C55E]" />
              <span className="font-medium text-[#22C55E]">{t("savedToShopifyBadge")}</span>
            </div>
            <p className="text-sm text-[#667085] mb-2">{t("step2AfterSave")}</p>
            {pack.saved_to_shopify_at && (
              <p className="text-xs text-[#94A3B8] mb-3">{t("lastSavedToShopify", { date: formatDate(pack.saved_to_shopify_at, locale) })}</p>
            )}
            <a
              href="https://admin.shopify.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#1D4ED8] hover:underline"
            >
              {t("openInShopifyAdmin")}
            </a>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={saving || pack.status === "saving" || isBuilding}
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
                <p className="text-sm text-[#DC2626]">{t("saveFailed")}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* G. Step 3 — Submit in Shopify Admin */}
      <StepCard stepNumber={3} title={t("step3Title")}>
        <p>{t("step3Description")}</p>
        <a
          href="https://admin.shopify.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-sm font-medium text-[#1D4ED8] hover:underline"
        >
          {t("openInShopifyAdmin")}
        </a>
      </StepCard>

      {/* H. Optional — Export PDF */}
      <div className="bg-white rounded-xl border border-[#E5E7EB] p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#0B1220] mb-2">{t("stepOptionalPdfTitle")}</h3>
        <p className="text-sm text-[#667085] mb-2">{t("stepOptionalPdfDescription")}</p>
        <p className="text-sm text-[#94A3B8] mb-4">{t("stepOptionalPdfNote")}</p>
        {pack.active_pdf_job ? (
          <p className="text-sm text-[#1E40AF]">{t("generatingPdf")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportPdf}
              disabled={rendering}
            >
              {rendering ? t("generatingPdf") : pack.pdf_path ? t("reRenderPdf") : t("exportPdf")}
            </Button>
            {pack.pdf_path && (
              <Button variant="primary" size="sm" onClick={handleDownload}>
                {t("downloadPdfReady")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Status banner */}
      <div className="mb-6">
        <StatusBanner variant={statusBanner.variant} message={statusBanner.message} />
      </div>

      {/* Audit log */}
      {pack.audit_events.length > 0 && (
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 mb-6">
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
      <div className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-sm text-[#667085]">
        <Shield className="w-4 h-4 inline mr-2 align-middle" />
        {t("compliance")}
      </div>
    </div>
  );
}

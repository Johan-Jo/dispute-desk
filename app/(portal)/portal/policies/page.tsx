"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { FileText, Eye, Download, Upload, Copy, Check } from "lucide-react";
import { useCompleteSetupStep } from "@/lib/setup/useCompleteSetupStep";
import { useActiveShopId } from "@/lib/portal/activeShopContext";
import { useDemoMode } from "@/lib/demo-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DemoNotice } from "@/components/ui/demo-notice";
import { InfoBanner } from "@/components/ui/info-banner";
import { Modal } from "@/components/ui/modal";

const POLICY_ROWS = [
  { nameKey: "termsOfService", typeKey: "legalAgreement", policyType: "terms" as const },
  { nameKey: "refundPolicy", typeKey: "customerPolicy", policyType: "refunds" as const },
  { nameKey: "shippingPolicy", typeKey: "customerPolicy", policyType: "shipping" as const },
];

const TEMPLATE_DESC_KEYS: Record<string, string> = {
  refunds: "refundTemplateDesc",
  shipping: "shippingTemplateDesc",
  terms: "termsTemplateDesc",
};
const TEMPLATE_TITLE_KEYS: Record<string, string> = {
  refunds: "refundPolicy",
  shipping: "shippingPolicy",
  terms: "termsOfService",
};

export default function PoliciesPage() {
  useCompleteSetupStep("business_policies");
  const t = useTranslations("policies");
  const tc = useTranslations("common");
  const locale = useLocale();
  const isDemo = useDemoMode();
  const shopId = useActiveShopId() ?? "";

  const [policyByType, setPolicyByType] = useState<Record<string, { url: string | null; captured_at: string }>>({});
  const [templates, setTemplates] = useState<{ type: string; name: string; description: string }[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalType, setTemplateModalType] = useState<string | null>(null);
  const [templateModalBody, setTemplateModalBody] = useState("");
  const [templateModalLoading, setTemplateModalLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [showMissingBanner, setShowMissingBanner] = useState(true);
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchPolicies = useCallback(async () => {
    if (isDemo || !shopId) return;
    try {
      const res = await fetch(`/api/policies?shop_id=${encodeURIComponent(shopId)}`);
      const data = await res.json();
      const list = data.policies ?? [];
      const byType: Record<string, { url: string | null; captured_at: string }> = {};
      for (const p of list) {
        byType[p.policy_type] = { url: p.url ?? null, captured_at: p.captured_at ?? "" };
      }
      setPolicyByType(byType);
    } catch {
      setPolicyByType({});
    }
  }, [shopId, isDemo]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/policy-templates");
      if (res.ok) {
        const data = await res.json();
        const list = data.templates ?? [];
        setTemplates(
          list.map((tmpl: { type: string; name: string; description: string }) => ({
            type: tmpl.type,
            name: tmpl.name,
            description: tmpl.description,
          }))
        );
      }
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (!isDemo && !shopId) return;
    if (isDemo || !shopId) return;
    const hasAny = Object.keys(policyByType).length > 0;
    if (!hasAny) fetchTemplates();
  }, [isDemo, shopId, policyByType, fetchTemplates]);

  const policies = POLICY_ROWS.map((row) => {
    const api = policyByType[row.policyType];
    return {
      ...row,
      url: api?.url ?? null,
      lastUpdated: api?.captured_at ?? null,
    };
  });

  const hasPolicies = Object.keys(policyByType).length > 0;

  const openTemplateModal = useCallback(async (type: string) => {
    setTemplateModalType(type);
    setTemplateModalOpen(true);
    setTemplateModalBody("");
    setTemplateModalLoading(true);
    try {
      const res = await fetch(`/api/policy-templates/${type}/content`);
      if (res.ok) {
        const data = await res.json();
        setTemplateModalBody(data.body ?? "");
      }
    } catch {
      setTemplateModalBody("");
    } finally {
      setTemplateModalLoading(false);
    }
  }, []);

  const handleCopyTemplate = useCallback(() => {
    if (!templateModalBody) return;
    void navigator.clipboard.writeText(templateModalBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [templateModalBody]);

  const handleDownloadTemplate = useCallback(() => {
    if (!templateModalBody || !templateModalType) return;
    const name = templateModalType === "refunds" ? "refund-policy" : templateModalType === "shipping" ? "shipping-policy" : "terms-of-service";
    const blob = new Blob([templateModalBody], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [templateModalBody, templateModalType]);

  const handleUpload = useCallback(
    async (policyType: string, file: File) => {
      if (!shopId || isDemo) return;
      setUploadingType(policyType);
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("shop_id", shopId);
        form.set("policy_type", policyType);
        const res = await fetch("/api/policies/upload", { method: "POST", body: form });
        if (res.ok) {
          await fetchPolicies();
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.error ?? t("uploadError"));
        }
      } catch {
        alert(t("uploadError"));
      } finally {
        setUploadingType(null);
      }
    },
    [shopId, isDemo, fetchPolicies, t]
  );

  const handlePreview = (url: string | null) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else alert(t("previewNotAvailable"));
  };

  const handleDownload = (url: string | null) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else alert(t("previewNotAvailable"));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220] mb-2">
            {hasPolicies ? t("title") : t("defineTitle")}
          </h1>
          <p className="text-sm text-[#667085]">
            {hasPolicies ? t("subtitle") : t("defineSubtitle")}
          </p>
        </div>
      </div>

      <DemoNotice />

      {hasPolicies && showMissingBanner && (
        <div className="mb-4">
          <InfoBanner variant="info" onDismiss={() => setShowMissingBanner(false)}>
            {t("missingPolicy")}
          </InfoBanner>
        </div>
      )}

      {!hasPolicies && !isDemo && shopId && (
        <>
          <div className="mb-6">
            <h4 className="text-sm font-medium text-[#0B1220] mb-3">{t("suggestedTemplates")}</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.type}
                  className="bg-white border border-[#E5E7EB] rounded-lg p-4 hover:border-[#CBD5E1] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-5 h-5 text-[#3B82F6]" />
                    <span className="font-medium text-[#0B1220] text-sm">{tmpl.name}</span>
                  </div>
                  <p className="text-xs text-[#667085] mb-4 line-clamp-2">
                    {t(TEMPLATE_DESC_KEYS[tmpl.type] ?? "refundTemplateDesc")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openTemplateModal(tmpl.type)}>
                      {t("useTemplate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current[tmpl.type]?.click()}
                      disabled={!!uploadingType}
                    >
                      {uploadingType === tmpl.type ? t("uploading") : t("uploadYourOwn")}
                    </Button>
                    <input
                      ref={(el) => {
                        fileInputRef.current[tmpl.type] = el;
                      }}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(tmpl.type, file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="space-y-3" data-onboarding="policy-documents">
        {policies.map((policy) => (
          <div
            key={policy.nameKey}
            className="bg-white rounded-lg border border-[#E5E7EB] p-4 sm:p-5 hover:border-[#CBD5E1] transition-colors"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-[#3B82F6]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#0B1220]">{t(policy.nameKey)}</h3>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <Badge variant={policy.typeKey === "legalAgreement" ? "info" : "default"}>
                      {t(policy.typeKey)}
                    </Badge>
                    {policy.url ? (
                      <span className="text-xs text-[#667085]">{t("defined")}</span>
                    ) : (
                      <span className="text-xs text-[#667085]">{t("notDefined")}</span>
                    )}
                    {policy.lastUpdated && (
                      <span className="text-xs text-[#667085]">
                        {t("updated")}{" "}
                        {new Date(policy.lastUpdated).toLocaleDateString(locale, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {policy.url ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => handlePreview(isDemo ? null : policy.url)}>
                      <Eye className="w-4 h-4 mr-1" />
                      {t("preview")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(isDemo ? null : policy.url)}>
                      <Download className="w-4 h-4 mr-1" />
                      {t("download")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openTemplateModal(policy.policyType)}
                      disabled={!!uploadingType}
                    >
                      {t("useTemplate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current[policy.policyType]?.click()}
                      disabled={!!uploadingType}
                    >
                      {uploadingType === policy.policyType ? (
                        t("uploading")
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-1" />
                          {t("addPolicy")}
                        </>
                      )}
                    </Button>
                    <input
                      ref={(el) => {
                        fileInputRef.current[policy.policyType] = el;
                      }}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(policy.policyType, file);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title={templateModalType ? t(TEMPLATE_TITLE_KEYS[templateModalType] ?? "useTemplate") : t("useTemplate")}
        description={t("templateDisclaimer")}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCopyTemplate} disabled={!templateModalBody}>
              {copied ? <Check className="w-4 h-4 mr-1 text-green-600" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? t("copied") : t("copyToClipboard")}
            </Button>
            <Button variant="secondary" onClick={handleDownloadTemplate} disabled={!templateModalBody}>
              <Download className="w-4 h-4 mr-1" />
              {t("downloadTemplate")}
            </Button>
            <Button variant="primary" onClick={() => setTemplateModalOpen(false)}>
              {tc("cancel")}
            </Button>
          </div>
        }
      >
        {templateModalLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
          </div>
        ) : (
          <pre className="text-xs text-[#0B1220] whitespace-pre-wrap font-sans max-h-[60vh] overflow-y-auto p-4 bg-[#F7F8FA] rounded-lg">
            {templateModalBody || ""}
          </pre>
        )}
      </Modal>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { FileText, Eye, Download, Upload, Copy, Check, Pencil } from "lucide-react";
import { useActiveShopId, useActiveShopData } from "@/lib/portal/activeShopContext";
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
  { nameKey: "privacyPolicy", typeKey: "customerPolicy", policyType: "privacy" as const },
  { nameKey: "contactPolicy", typeKey: "customerPolicy", policyType: "contact" as const },
];

const TEMPLATE_TITLE_KEYS: Record<string, string> = {
  terms: "termsOfService",
  refunds: "refundPolicy",
  shipping: "shippingPolicy",
  privacy: "privacyPolicy",
  contact: "contactPolicy",
};

const TEMPLATE_DOWNLOAD_FILENAMES: Record<string, string> = {
  terms: "terms-of-service",
  refunds: "refund-policy",
  shipping: "shipping-policy",
  privacy: "privacy-policy",
  contact: "contact-customer-service-policy",
};

function templateBodyToDisplayHtml(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function contentEditableHtmlToBody(html: string): string {
  let out = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/strong>/gi, "**")
    .replace(/<strong>/gi, "**");
  out = out.replace(/<[^>]+>/g, "");
  return out
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">");
}

/** Strip ** markdown so output is plain text with no asterisks (bold only visual in editor). */
function bodyToPlainText(body: string): string {
  return body.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export default function PoliciesPage() {
  // TODO: Re-wire portal auto-complete for new wizard steps
  const searchParams = useSearchParams();
  const t = useTranslations("policies");
  const tc = useTranslations("common");
  const locale = useLocale();
  const isDemo = useDemoMode();
  const shopId = useActiveShopId() ?? "";
  const shopData = useActiveShopData();

  const [policyByType, setPolicyByType] = useState<Record<string, { url: string | null; captured_at: string }>>({});
  const [templates, setTemplates] = useState<
    {
      type: string;
      name: string;
      description: string;
      bestFor?: string;
      disputeDefenseValue?: string;
      qualityBadge?: string;
      categoryTags?: string[];
      merchantPlaceholders?: string[];
      merchantNotes?: string[];
    }[]
  >([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalType, setTemplateModalType] = useState<string | null>(null);
  const [templateModalBody, setTemplateModalBody] = useState("");
  const [templateModalLoading, setTemplateModalLoading] = useState(false);
  const [templateApplying, setTemplateApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [clearingPolicies, setClearingPolicies] = useState(false);
  const [showMissingBanner, setShowMissingBanner] = useState(true);
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const templateEditorRef = useRef<HTMLDivElement | null>(null);
  const skipNextEditorSyncRef = useRef(false);

  const fetchPolicies = useCallback(
    async (cacheBust = false) => {
      if (isDemo || !shopId) return;
      try {
        const url = cacheBust
          ? `/api/policies?shop_id=${encodeURIComponent(shopId)}&_=${Date.now()}`
          : `/api/policies?shop_id=${encodeURIComponent(shopId)}`;
        const res = await fetch(url);
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
    },
    [shopId, isDemo]
  );

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
          list.map(
            (tmpl: {
              type: string;
              name: string;
              description: string;
              bestFor?: string;
              disputeDefenseValue?: string;
              qualityBadge?: string;
              categoryTags?: string[];
              merchantPlaceholders?: string[];
              merchantNotes?: string[];
            }) => ({
              type: tmpl.type,
              name: tmpl.name,
              description: tmpl.description,
              bestFor: tmpl.bestFor,
              disputeDefenseValue: tmpl.disputeDefenseValue,
              qualityBadge: tmpl.qualityBadge,
              categoryTags: tmpl.categoryTags,
              merchantPlaceholders: tmpl.merchantPlaceholders,
              merchantNotes: tmpl.merchantNotes,
            })
          )
        );
      }
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (isDemo || !shopId) return;
    fetchTemplates();
  }, [isDemo, shopId, fetchTemplates]);

  const policyHighlight = searchParams.get("policy");
  useEffect(() => {
    if (!policyHighlight) return;
    const el = document.getElementById(`policy-${policyHighlight}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [policyHighlight]);

  const policies = POLICY_ROWS.map((row) => {
    const api = policyByType[row.policyType];
    return {
      ...row,
      url: api?.url ?? null,
      lastUpdated: api?.captured_at ?? null,
    };
  });

  const hasPolicies = Object.keys(policyByType).length > 0;

  const prefillTemplateBody = useCallback(
    (body: string, templateType: string): string => {
      let out = body;
      const domain = shopData.shop_domain ?? "";
      const storeName = domain.replace(/\.myshopify\.com$/i, "") || "Your Store";
      const supportEmail = domain ? `support@${domain}` : "support@yourstore.com";
      const today = new Date().toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const jurisdiction =
        (shopData.locale && shopData.locale.startsWith("en-")) || !shopData.locale
          ? "the United States"
          : shopData.locale.startsWith("en-GB")
            ? "England and Wales"
            : "your jurisdiction";

      out = out.replace(/\[Your Store Name\]/g, storeName);
      out = out.replace(/\[Store Name\]/g, storeName);
      out = out.replace(/\[Date\]/g, today);
      out = out.replace(/\[your support email\]/g, supportEmail);
      out = out.replace(/\[Support Email\]/g, supportEmail);
      out = out.replace(/\[Privacy Email \/ Support Email\]/g, supportEmail);
      out = out.replace(/\[cutoff time\]/g, "2:00 PM");
      out = out.replace(/\[amount\]/g, "$50");
      out = out.replace(/\[Carrier names, e\.g\. USPS, UPS, FedEx\]/g, "USPS, UPS, FedEx");
      out = out.replace(/\[Jurisdiction\]/g, jurisdiction);
      out = out.replace(/\[Legal Company Name\]/g, storeName);
      out = out.replace(/\[Registered Address\]/g, "[Registered Address]");
      out = out.replace(/\[Business Address\]/g, "[Business Address]");
      out = out.replace(/\[Phone Number, if applicable\]/g, "[Phone Number]");
      out = out.replace(/\[Currency\]/g, "USD");
      out = out.replace(/\[Country \/ State\]/g, jurisdiction);
      out = out.replace(/\[Company Registration Number \/ Tax ID, if applicable\]/g, "[Tax ID]");
      out = out.replace(/\[Days and Hours, including time zone\]/g, "Monday–Friday, 9am–5pm local");
      out = out.replace(/\[Days and Hours\]/g, "Monday–Friday, 9am–5pm local");
      if (templateType === "shipping") {
        out = out.replace(/\*\*\[X\]\*\* business days/, "**3** business days");
        out = out.replace(/\*\*\[X–Y\] business days\*\*/g, "**5–10** business days");
        out = out.replace(/\*\*\[X-Y\] business days\*\*/g, "**5–10** business days");
        out = out.replace(/\[X\] business days/g, "**5** business days");
        out = out.replace(/\[X\] days of delivery/g, "**30** days of delivery");
        out = out.replace(/\[list countries\/regions\]/g, "the United States and Canada");
        out = out.replace(/\[X\]/g, "**3**");
      } else {
        out = out.replace(/\*\*\[X\]\*\*/g, "**30**");
        out = out.replace(/\[X\]/g, "**30**");
      }
      out = out.replace(/\[X–Y\]/g, "**5–10**");
      out = out.replace(/\[X-Y\]/g, "**5–10**");
      return out;
    },
    [shopData.shop_domain, shopData.locale, locale]
  );

  const openTemplateModal = useCallback(
    async (type: string) => {
      setTemplateModalType(type);
      setTemplateModalOpen(true);
      setTemplateModalBody("");
      setTemplateModalLoading(true);
      skipNextEditorSyncRef.current = false;
      try {
        const url = shopId
          ? `/api/policy-templates/${type}/content?shop_id=${encodeURIComponent(shopId)}`
          : `/api/policy-templates/${type}/content`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const raw = data.body ?? "";
          skipNextEditorSyncRef.current = true;
          setTemplateModalBody(prefillTemplateBody(raw, type));
        }
      } catch {
        setTemplateModalBody("");
      } finally {
        setTemplateModalLoading(false);
      }
    },
    [prefillTemplateBody, shopId]
  );

  const openTemplateModalForEdit = useCallback(
    async (type: string) => {
      setTemplateModalType(type);
      setTemplateModalOpen(true);
      setTemplateModalBody("");
      setTemplateModalLoading(true);
      skipNextEditorSyncRef.current = false;
      try {
        const contentRes = await fetch(
          `/api/policies/content?shop_id=${encodeURIComponent(shopId)}&policy_type=${encodeURIComponent(type)}`
        );
        if (contentRes.ok) {
          const { content } = (await contentRes.json()) as { content?: string | null };
          if (content != null && content.trim() !== "") {
            skipNextEditorSyncRef.current = true;
            setTemplateModalBody(content);
            setTemplateModalLoading(false);
            return;
          }
        }
        const templateUrl = shopId
          ? `/api/policy-templates/${type}/content?shop_id=${encodeURIComponent(shopId)}`
          : `/api/policy-templates/${type}/content`;
        const templateRes = await fetch(templateUrl);
        if (templateRes.ok) {
          const data = await templateRes.json();
          const raw = data.body ?? "";
          skipNextEditorSyncRef.current = true;
          setTemplateModalBody(prefillTemplateBody(raw, type));
        }
      } catch {
        setTemplateModalBody("");
      } finally {
        setTemplateModalLoading(false);
      }
    },
    [prefillTemplateBody, shopId]
  );

  useEffect(() => {
    if (!templateModalOpen || !templateModalBody || !templateEditorRef.current) return;
    if (!skipNextEditorSyncRef.current) return;
    skipNextEditorSyncRef.current = false;
    const html = templateBodyToDisplayHtml(templateModalBody);
    templateEditorRef.current.innerHTML = html.replace(/\n/g, "<br>");
  }, [templateModalOpen, templateModalBody]);

  const getEditorBody = useCallback((): string => {
    const el = templateEditorRef.current;
    return el ? contentEditableHtmlToBody(el.innerHTML) : templateModalBody;
  }, [templateModalBody]);

  const handleCopyTemplate = useCallback(() => {
    const body = bodyToPlainText(getEditorBody());
    if (!body) return;
    void navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [getEditorBody]);

  const handleDownloadTemplate = useCallback(() => {
    const body = bodyToPlainText(getEditorBody());
    if (!body || !templateModalType) return;
    const name = TEMPLATE_DOWNLOAD_FILENAMES[templateModalType] ?? templateModalType;
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getEditorBody, templateModalType]);

  const handleSaveAndApply = useCallback(async () => {
    const body = bodyToPlainText(getEditorBody()).trim();
    if (!shopId || isDemo || !body || !templateModalType) return;
    setTemplateApplying(true);
    try {
      const res = await fetch("/api/policies/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_id: shopId,
          policy_type: templateModalType,
          content: body,
        }),
      });
      if (res.ok) {
        await fetchPolicies(true);
        setTemplateModalOpen(false);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? t("uploadError"));
      }
    } catch {
      alert(t("uploadError"));
    } finally {
      setTemplateApplying(false);
    }
  }, [shopId, isDemo, getEditorBody, templateModalType, fetchPolicies, t]);

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

  const handleClearAllPolicies = useCallback(async () => {
    if (isDemo || !shopId) return;
    if (!window.confirm(t("clearAllPoliciesConfirm"))) return;
    setClearingPolicies(true);
    try {
      const res = await fetch("/api/policies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId }),
      });
      if (res.ok) {
        await fetchPolicies(true);
        alert(t("clearAllPoliciesSuccess"));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? t("clearAllPoliciesError"));
      }
    } catch {
      alert(t("clearAllPoliciesError"));
    } finally {
      setClearingPolicies(false);
    }
  }, [shopId, isDemo, fetchPolicies, t]);

  const returnUrl = searchParams.get("returnUrl");

  return (
    <div>
      {returnUrl && (
        <div className="mb-4">
          <InfoBanner variant="info">
            <Link
              href={decodeURIComponent(returnUrl)}
              className="font-semibold underline hover:no-underline text-[#0B1220]"
            >
              {t("returnToTemplateSetup")}
            </Link>
          </InfoBanner>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0B1220] mb-2">
            {hasPolicies ? t("title") : t("defineTitle")}
          </h1>
          <p className="text-sm text-[#667085]">
            {hasPolicies ? t("subtitle") : t("defineSubtitle")}
          </p>
        </div>
        {hasPolicies && !isDemo && shopId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAllPolicies}
            disabled={clearingPolicies}
            className="text-[#64748B] hover:text-[#0B1220]"
          >
            {clearingPolicies ? tc("loading") : t("clearAllPolicies")}
          </Button>
        )}
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
            <h2 className="text-lg font-semibold text-[#0B1220] mb-1">{t("policyLibraryTitle")}</h2>
            <p className="text-sm text-[#667085] mb-4">{t("policyLibrarySubtitle")}</p>
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
              {templates.map((tmpl) => (
                <div
                  key={tmpl.type}
                  className="bg-white border border-[#E5E7EB] rounded-lg p-4 hover:border-[#CBD5E1] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-5 h-5 text-[#3B82F6] flex-shrink-0" />
                      <span className="font-medium text-[#0B1220] text-sm">{tmpl.name}</span>
                    </div>
                    {tmpl.qualityBadge && (
                      <Badge variant="default" className="text-xs flex-shrink-0">
                        {tmpl.qualityBadge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[#667085] mb-2 line-clamp-2">{tmpl.description}</p>
                  {tmpl.bestFor && (
                    <p className="text-xs text-[#475569] mb-1">
                      <span className="font-medium">{t("bestFor")}:</span> {tmpl.bestFor}
                    </p>
                  )}
                  {tmpl.disputeDefenseValue && (
                    <p className="text-xs text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded px-2 py-1.5 mb-3">
                      {tmpl.disputeDefenseValue}
                    </p>
                  )}
                  {tmpl.categoryTags && tmpl.categoryTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {tmpl.categoryTags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="default" className="text-[10px] font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
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
            id={`policy-${policy.policyType}`}
            key={policy.nameKey}
            className="bg-white rounded-lg border border-[#E5E7EB] p-4 sm:p-5 hover:border-[#CBD5E1] transition-colors scroll-mt-4"
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
                      <>
                        <span className="text-xs text-[#667085]">{t("defined")}</span>
                        <Badge variant="default" className="bg-[#059669] text-white text-xs font-medium">
                          {t("applied")}
                        </Badge>
                      </>
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
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => (isDemo ? undefined : openTemplateModalForEdit(policy.policyType))}
                      disabled={!!isDemo}
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      {t("edit")}
                    </Button>
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
        title={templateModalType ? t(TEMPLATE_TITLE_KEYS[templateModalType] ?? templateModalType) : t("useTemplate")}
        description={t("templateDisclaimer")}
        size="lg"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleCopyTemplate} disabled={!templateModalBody}>
                {copied ? <Check className="w-4 h-4 mr-1 text-green-600" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? t("copied") : t("copyToClipboard")}
              </Button>
              <Button variant="secondary" onClick={handleDownloadTemplate} disabled={!templateModalBody}>
                <Download className="w-4 h-4 mr-1" />
                {t("downloadTemplate")}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleSaveAndApply} disabled={!templateModalBody?.trim() || templateApplying || isDemo}>
                {templateApplying ? t("applying") : t("saveAndApply")}
              </Button>
              <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>
                {tc("cancel")}
              </Button>
            </div>
          </div>
        }
      >
        {templateModalLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded-md px-3 py-2">
              {t("suggestedStandardsNote")}
            </p>
            <p className="text-xs font-medium text-[#0B1220] bg-[#FEF3C7] border border-[#FCD34D] rounded-md px-3 py-2">
              {t("verifyBoldBeforeAccept")}
            </p>
            {templateModalType && (() => {
              const tmpl = templates.find((x) => x.type === templateModalType);
              if (!tmpl?.merchantNotes?.length) return null;
              return (
                <div className="text-xs text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] rounded-md px-3 py-2">
                  <p className="font-medium text-[#0B1220] mb-1">{t("merchantNotesLabel")}</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {tmpl.merchantNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            <div className="relative">
              <div
                ref={templateEditorRef}
                contentEditable
                suppressContentEditableWarning
                className="w-full text-xs text-[#0B1220] font-sans max-h-[50vh] min-h-[280px] overflow-y-auto p-4 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] focus:bg-white focus:ring-2 focus:ring-[#1D4ED8] focus:border-[#1D4ED8] outline-none [&_strong]:font-bold"
                data-placeholder={t("editTemplatePlaceholder")}
                spellCheck
                onInput={() => {
                  const el = templateEditorRef.current;
                  if (!el) return;
                  const body = contentEditableHtmlToBody(el.innerHTML);
                  setTemplateModalBody(body);
                }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

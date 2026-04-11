"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link, FileText, Upload, Zap, CheckCircle2, ArrowLeft, X, Layers, Info } from "lucide-react";
import type { StepId } from "@/lib/setup/types";

type PolicyKey = "shipping" | "refunds" | "terms" | "privacy";
type FlowType = "own" | "template" | "mixed";
type MixedOption = "url" | "upload" | "template";
type OwnOption = "url" | "upload";

const POLICY_KEYS: PolicyKey[] = ["shipping", "refunds", "terms", "privacy"];

const POLICY_PATHS: Record<PolicyKey, string> = {
  shipping: "/policies/shipping-policy",
  refunds: "/policies/refund-policy",
  terms: "/policies/terms-of-service",
  privacy: "/policies/privacy-policy",
};

interface BusinessPoliciesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

function getShopOriginFallback(): string | null {
  const domain = document.cookie.match(/shopify_shop=([^;]+)/)?.[1];
  if (domain) return `https://${domain}`;
  const shopParam = new URLSearchParams(window.location.search).get("shop");
  if (shopParam) return `https://${shopParam}`;
  return null;
}

const LANG_LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  pt: "Português",
  sv: "Svenska",
};

export function BusinessPoliciesStep({ stepId, onSaveRef }: BusinessPoliciesStepProps) {
  const t = useTranslations("setup.policies");
  const tCommon = useTranslations("common");
  const [selectedFlow, setSelectedFlow] = useState<FlowType | null>(null);
  const [resolvedShopId, setResolvedShopId] = useState<string | null>(null);
  const [templateLang, setTemplateLang] = useState<string>("en");
  const [localLang, setLocalLang] = useState<string | null>(null);
  const [langSaving, setLangSaving] = useState(false);

  const [ownUrls, setOwnUrls] = useState<Record<PolicyKey, string>>({
    shipping: "", refunds: "", terms: "", privacy: "",
  });
  const [ownOptions, setOwnOptions] = useState<Record<PolicyKey, OwnOption>>({
    shipping: "url", refunds: "url", terms: "url", privacy: "url",
  });

  const [mixedOptions, setMixedOptions] = useState<Record<PolicyKey, MixedOption>>({
    shipping: "url", refunds: "url", terms: "url", privacy: "url",
  });
  const [mixedUrls, setMixedUrls] = useState<Record<PolicyKey, string>>({
    shipping: "", refunds: "", terms: "", privacy: "",
  });
  const [uploadedFiles, setUploadedFiles] = useState<Partial<Record<PolicyKey, { id: string; url: string }>>>({});
  const [uploadLoading, setUploadLoading] = useState<Partial<Record<PolicyKey, boolean>>>({});

  const [previewKey, setPreviewKey] = useState<PolicyKey | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewOriginal, setPreviewOriginal] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewEditing, setPreviewEditing] = useState(false);
  const [templateDrafts, setTemplateDrafts] = useState<Partial<Record<PolicyKey, string>>>({});
  const [templateSelections, setTemplateSelections] = useState<Record<PolicyKey, boolean>>({
    shipping: true,
    refunds: true,
    terms: false,
    privacy: false,
  });

  useEffect(() => {
    const fallbackOrigin = getShopOriginFallback();
    if (fallbackOrigin) {
      const base = fallbackOrigin.replace(/\/$/, "");
      const prefilled = Object.fromEntries(
        POLICY_KEYS.map((k) => [k, `${base}${POLICY_PATHS[k]}`])
      ) as Record<PolicyKey, string>;
      setOwnUrls(prefilled);
      setMixedUrls(prefilled);
    }

    fetch("/api/setup/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.shopId) return;
        setResolvedShopId(data.shopId);
        fetch(`/api/shop/policy-template-lang?shop_id=${data.shopId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((langData) => {
            if (!langData) return;
            if (langData.policy_template_lang) setTemplateLang(langData.policy_template_lang);
            if (langData.local_lang) setLocalLang(langData.local_lang);
          })
          .catch(() => {});
        return fetch(`/api/shop/details?shop_id=${data.shopId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((details) => {
            if (!details?.primaryDomain) return;
            const base = details.primaryDomain.replace(/\/$/, "");
            if (fallbackOrigin && base === fallbackOrigin.replace(/\/$/, "")) return;
            const prefilled = Object.fromEntries(
              POLICY_KEYS.map((k) => [k, `${base}${POLICY_PATHS[k]}`])
            ) as Record<PolicyKey, string>;
            setOwnUrls(prefilled);
            setMixedUrls(prefilled);
          });
      })
      .catch(() => {});
  }, []);

  const openPreview = useCallback(
    async (key: PolicyKey) => {
      setPreviewKey(key);
      setPreviewEditing(false);
      setPreviewContent("");
      setPreviewOriginal("");
      setPreviewLoading(true);
      try {
        const qs = resolvedShopId ? `?shop_id=${resolvedShopId}` : "";
        const res = await fetch(`/api/policy-templates/${key}/content${qs}`);
        if (res.ok) {
          const { body } = (await res.json()) as { body?: string };
          const resolvedBody = templateDrafts[key] ?? (body ?? "");
          setPreviewContent(resolvedBody);
          setPreviewOriginal(resolvedBody);
        } else {
          const fallback = templateDrafts[key] ?? t("templateLoadError");
          setPreviewContent(fallback);
          setPreviewOriginal(fallback);
        }
      } catch {
        const fallback = templateDrafts[key] ?? t("templateLoadError");
        setPreviewContent(fallback);
        setPreviewOriginal(fallback);
      }
      setPreviewLoading(false);
    },
    [resolvedShopId, t, templateDrafts]
  );

  const handleFileUpload = useCallback(
    async (key: PolicyKey, file: File) => {
      setUploadLoading((prev) => ({ ...prev, [key]: true }));
      const form = new FormData();
      form.append("file", file);
      form.append("policy_type", key);
      if (resolvedShopId) form.append("shop_id", resolvedShopId);
      try {
        const res = await fetch("/api/policies/upload", { method: "POST", body: form });
        if (res.ok) {
          const { id, url } = (await res.json()) as { id: string; url: string };
          setUploadedFiles((prev) => ({ ...prev, [key]: { id, url } }));
        }
      } catch {}
      setUploadLoading((prev) => ({ ...prev, [key]: false }));
    },
    [resolvedShopId]
  );

  useEffect(() => {
    onSaveRef.current = async () => {
      if (!selectedFlow) return false;

      const templateKeys: PolicyKey[] =
        selectedFlow === "template"
          ? POLICY_KEYS.filter((k) => templateSelections[k])
          : selectedFlow === "mixed"
          ? POLICY_KEYS.filter((k) => mixedOptions[k] === "template")
          : [];

      for (const key of templateKeys) {
        let body = templateDrafts[key] ?? "";
        if (!body) {
          const qs = resolvedShopId ? `?shop_id=${resolvedShopId}` : "";
          const contentRes = await fetch(`/api/policy-templates/${key}/content${qs}`);
          if (!contentRes.ok) return false;
          const contentJson = (await contentRes.json()) as { body?: string };
          body = contentJson.body ?? "";
        }
        const applyRes = await fetch("/api/policies/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: resolvedShopId, policy_type: key, content: body }),
        });
        if (!applyRes.ok) return false;
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { flow: selectedFlow, ownOptions, ownUrls, mixedOptions, mixedUrls, uploadedFiles, templateSelections },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, selectedFlow, ownOptions, ownUrls, mixedOptions, mixedUrls, uploadedFiles, resolvedShopId, templateDrafts, templateSelections]);

  const meta: Record<PolicyKey, { title: string; desc: string }> = {
    shipping: { title: t("shippingTitle"), desc: t("shippingDesc") },
    refunds:  { title: t("refundsTitle"),  desc: t("refundsDesc") },
    terms:    { title: t("termsTitle"),    desc: t("termsDesc") },
    privacy:  { title: t("privacyTitle"), desc: t("privacyDesc") },
  };

  const policyIsRequired: Record<PolicyKey, boolean> = {
    shipping: true,
    refunds: true,
    terms: false,
    privacy: false,
  };

  const ownPolicySupportCopy: Record<PolicyKey, string> = {
    shipping: t("ownShippingSupport"),
    refunds: t("ownRefundsSupport"),
    terms: t("ownTermsSupport"),
    privacy: t("ownPrivacySupport"),
  };

  const handleLangChange = useCallback(
    async (nextLang: string) => {
      if (nextLang === templateLang || !resolvedShopId) return;
      setLangSaving(true);
      const previous = templateLang;
      setTemplateLang(nextLang);
      setTemplateDrafts({});
      try {
        const res = await fetch("/api/shop/policy-template-lang", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: resolvedShopId, policy_template_lang: nextLang }),
        });
        if (!res.ok) setTemplateLang(previous);
      } catch {
        setTemplateLang(previous);
      } finally {
        setLangSaving(false);
      }
    },
    [templateLang, resolvedShopId]
  );

  const hasLocalOption = localLang !== null && localLang !== "en";
  const localOptionValue = hasLocalOption ? localLang! : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex flex-col items-center text-center mb-6">
        <div className="w-16 h-16 rounded-[14px] bg-[#D89A2B] flex items-center justify-center mb-5">
          <FileText className="w-7 h-7 text-white" />
        </div>
        <h2 className="leading-[34px] text-[#202223] mb-2" style={{ fontWeight: 700, fontSize: 26 }}>{t("title")}</h2>
        <p className="leading-[24px] text-[#6D7175]" style={{ fontSize: 15 }}>{t("flowSelectSubtitle")}</p>
      </div>

      {hasLocalOption && (
        <div className="flex flex-col items-center mb-8">
          <p className="text-[#6D7175] mb-2" style={{ fontSize: 13 }}>{t("languageLabel")}</p>
          <div className="inline-flex rounded-[10px] border border-[#E1E3E5] bg-white p-1" role="group">
            <button
              type="button"
              onClick={() => handleLangChange("en")}
              disabled={langSaving}
              className={`px-5 py-2 rounded-[8px] transition-colors ${
                templateLang === "en"
                  ? "bg-[#1D4ED8] text-white"
                  : "text-[#202223] hover:bg-[#F3F4F6]"
              }`}
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => handleLangChange(localOptionValue!)}
              disabled={langSaving}
              className={`px-5 py-2 rounded-[8px] transition-colors ${
                templateLang === localOptionValue
                  ? "bg-[#1D4ED8] text-white"
                  : "text-[#202223] hover:bg-[#F3F4F6]"
              }`}
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              {LANG_LABELS[localOptionValue!]}
            </button>
          </div>
          <p className="text-[#8C9196] mt-2 text-center" style={{ fontSize: 12 }}>{t("languageHint")}</p>
        </div>
      )}

      {/* ── Flow selection ── */}
      {!selectedFlow && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <button
              onClick={() => setSelectedFlow("own")}
              className="bg-white border border-[#E1E3E5] hover:border-[#1D4ED8] rounded-[16px] px-8 py-7 text-center transition-all group flex flex-col items-center min-h-[172px]"
            >
              <div className="w-14 h-14 rounded-[12px] bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center transition-colors mb-7">
                <Link className="w-7 h-7 text-[#8C9196] group-hover:text-[#1D4ED8]" />
              </div>
              <h3 className="leading-[24px] text-[#202223] mb-1.5" style={{ fontWeight: 700, fontSize: 16 }}>{t("ownFlowTitle")}</h3>
              <p className="leading-[20px] text-[#6D7175]" style={{ fontSize: 14 }}>{t("ownFlowShortDesc")}</p>
            </button>

            <button
              onClick={() => setSelectedFlow("template")}
              className="bg-white border border-[#E1E3E5] hover:border-[#1D4ED8] rounded-[16px] px-8 py-7 text-center transition-all group flex flex-col items-center min-h-[172px]"
            >
              <div className="w-14 h-14 rounded-[12px] bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center transition-colors mb-7">
                <Zap className="w-7 h-7 text-[#8C9196] group-hover:text-[#1D4ED8]" />
              </div>
              <h3 className="leading-[24px] text-[#202223] mb-1.5" style={{ fontWeight: 700, fontSize: 16 }}>{t("templateFlowTitle")}</h3>
              <p className="leading-[20px] text-[#6D7175]" style={{ fontSize: 14 }}>{t("templateFlowShortDesc")}</p>
            </button>

            <button
              onClick={() => setSelectedFlow("mixed")}
              className="bg-white border border-[#E1E3E5] hover:border-[#1D4ED8] rounded-[16px] px-8 py-7 text-center transition-all group flex flex-col items-center min-h-[172px]"
            >
              <div className="w-14 h-14 rounded-[12px] bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center transition-colors mb-7">
                <Layers className="w-7 h-7 text-[#8C9196] group-hover:text-[#1D4ED8]" />
              </div>
              <h3 className="leading-[24px] text-[#202223] mb-1.5" style={{ fontWeight: 700, fontSize: 16 }}>{t("mixedFlowTitle")}</h3>
              <p className="leading-[20px] text-[#6D7175]" style={{ fontSize: 14 }}>{t("mixedFlowShortDesc")}</p>
            </button>
          </div>

          <div className="flex items-start gap-3 p-6 border border-[#E5E7EB] rounded-[12px] bg-[#F3F4F6]">
            <Info className="w-5 h-5 text-[#8C9196] flex-shrink-0 mt-[1px]" />
            <div>
              <p className="leading-[24px] text-[#202223] mb-1" style={{ fontWeight: 700, fontSize: 16 }}>{t("whyPoliciesTitle")}</p>
              <p className="leading-[22px] text-[#6D7175]" style={{ fontSize: 14 }}>{t("whyPoliciesDesc")}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Own flow ── */}
      {selectedFlow === "own" && (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedFlow(null)}
            className="flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1e40af] font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToSelection")}
          </button>

          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-[#1D4ED8] rounded-full flex items-center justify-center flex-shrink-0">
                <Link className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-[#1E40AF] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{t("ownBannerTitle")}</p>
                <p className="text-[#1E40AF]" style={{ fontSize: 14 }}>{t("ownBannerDesc")}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {POLICY_KEYS.map((key) => (
              <div key={key} className="border border-[#E1E3E5] rounded-lg p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-[#202223] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>
                      {meta[key].title}{policyIsRequired[key] ? " *" : ""}
                    </p>
                    <p className="text-[#6D7175]" style={{ fontSize: 12 }}>{ownPolicySupportCopy[key]}</p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs flex-shrink-0 ${
                      policyIsRequired[key] ? "bg-[#DCFCE7] text-[#059669]" : "bg-[#F1F2F4] text-[#6D7175]"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {policyIsRequired[key] ? t("requiredLabel") : t("optionalLabel")}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => setOwnOptions((prev) => ({ ...prev, [key]: "url" }))}
                    className={`px-3 py-2.5 border rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 ${
                      ownOptions[key] === "url"
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    <Link className="w-3.5 h-3.5" />
                    {t("linkUrlBtn")}
                  </button>
                  <button
                    onClick={() => setOwnOptions((prev) => ({ ...prev, [key]: "upload" }))}
                    className={`px-3 py-2.5 border rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 ${
                      ownOptions[key] === "upload"
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {t("uploadFileBtn")}
                  </button>
                </div>

                {ownOptions[key] === "url" ? (
                  <input
                    type="url"
                    value={ownUrls[key]}
                    onChange={(e) => setOwnUrls((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={`https://yourstore.myshopify.com${POLICY_PATHS[key]}`}
                    className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
                  />
                ) : uploadedFiles[key] ? (
                  <div className="flex items-center gap-3 p-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0" />
                    <p className="text-[#15803D] flex-1 truncate" style={{ fontSize: 14 }}>
                      {uploadedFiles[key]!.url.split("/").pop()}
                    </p>
                    <button
                      onClick={() => setUploadedFiles((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                      className="text-xs text-[#6D7175] hover:text-[#202223]"
                    >
                      {t("removeUpload")}
                    </button>
                  </div>
                ) : (
                  <label className="block border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                    <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                    <p className="text-[#202223] mb-1" style={{ fontWeight: 500, fontSize: 14 }}>{t("uploadCta")}</p>
                    <p className="text-[#6D7175]" style={{ fontSize: 12 }}>{t("uploadHintExtended")}</p>
                    {uploadLoading[key] && (
                      <p className="text-[#1D4ED8] mt-2" style={{ fontSize: 12 }}>Uploading…</p>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,.txt,.md"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(key, file);
                      }}
                    />
                  </label>
                )}
              </div>
            ))}
          </div>

          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[#1E40AF] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{t("ownAutoIncludedTitle")}</p>
                <p className="text-[#1E40AF]" style={{ fontSize: 14 }}>{t("ownAutoIncludedDesc")}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Template flow ── */}
      {selectedFlow === "template" && (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedFlow(null)}
            className="flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1e40af] font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToOptions")}
          </button>

          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-[#1D4ED8] rounded-full flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-[#1E40AF] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{t("templateBannerTitle")}</p>
                <p className="text-[#1E40AF]" style={{ fontSize: 14 }}>{t("templateBannerDesc")}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {POLICY_KEYS.map((key) => (
              <div key={key} className="border border-[#E1E3E5] rounded-lg p-4 hover:border-[#1D4ED8] transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <FileText className={`w-5 h-5 flex-shrink-0 mt-0.5 ${policyIsRequired[key] ? "text-[#1D4ED8]" : "text-[#6D7175]"}`} />
                    <div>
                      <p className="text-[#202223] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{meta[key].title}</p>
                      <p className="text-[#6D7175]" style={{ fontSize: 14 }}>{meta[key].desc}</p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs flex-shrink-0 ${
                      policyIsRequired[key] ? "bg-[#DCFCE7] text-[#059669]" : "bg-[#F1F2F4] text-[#6D7175]"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {policyIsRequired[key] ? t("requiredLabel") : t("optionalLabel")}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => openPreview(key)}
                    className="w-full px-4 py-2 bg-[#F7F8FA] hover:bg-[#E1E3E5] border border-[#E1E3E5] text-sm text-[#202223] rounded-lg transition-colors"
                    style={{ fontWeight: 600 }}
                  >
                    {t("previewTemplateBtn")}
                  </button>
                  <button
                    onClick={() =>
                      setTemplateSelections((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                      }))
                    }
                    className={`w-full px-4 py-2 border text-sm rounded-lg transition-colors flex items-center justify-center gap-2 ${
                      templateSelections[key]
                        ? "bg-[#22C55E] border-[#22C55E] text-white"
                        : "bg-[#1D4ED8] border-[#1D4ED8] text-white hover:bg-[#1e40af]"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {templateSelections[key] ? `${t("applied")} ✓` : t("useTemplate")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[#FFF4E5] border border-[#FFCC80] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-[#B95000] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[#202223] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{t("customizeAfterGenerationTitle")}</p>
                <p className="text-[#6D7175]" style={{ fontSize: 14 }}>{t("customizeAfterGenerationDesc")}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Mixed flow ── */}
      {selectedFlow === "mixed" && (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedFlow(null)}
            className="flex items-center gap-2 text-sm text-[#1D4ED8] hover:text-[#1e40af] font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("backToOptions")}
          </button>

          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 bg-[#1D4ED8] rounded-full flex items-center justify-center flex-shrink-0">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-[#1E40AF] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{t("mixedBannerTitle")}</p>
                <p className="text-[#1E40AF]" style={{ fontSize: 14 }}>{t("mixedBannerDesc")}</p>
              </div>
            </div>
          </div>

          {POLICY_KEYS.map((key) => (
            <div key={key} className="border border-[#E1E3E5] rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[#202223] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>
                    {meta[key].title}{policyIsRequired[key] ? " *" : ""}
                  </p>
                  <p className="text-[#6D7175]" style={{ fontSize: 12 }}>{ownPolicySupportCopy[key]}</p>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs flex-shrink-0 ${
                    policyIsRequired[key] ? "bg-[#DCFCE7] text-[#059669]" : "bg-[#F1F2F4] text-[#6D7175]"
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  {policyIsRequired[key] ? t("requiredLabel") : t("optionalLabel")}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {(["url", "upload", "template"] as MixedOption[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setMixedOptions((prev) => ({ ...prev, [key]: opt }))}
                    className={`px-3 py-2.5 border rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 ${
                      mixedOptions[key] === opt
                        ? "border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]"
                        : "border-[#E1E3E5] text-[#6D7175] hover:border-[#C9CCCF]"
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {opt === "url" && <Link className="w-3.5 h-3.5" />}
                    {opt === "upload" && <Upload className="w-3.5 h-3.5" />}
                    {opt === "template" && <Zap className="w-3.5 h-3.5" />}
                    {opt === "url" ? t("linkUrlBtn") : opt === "upload" ? t("uploadFileBtn") : t("optionTemplate")}
                  </button>
                ))}
              </div>

              {mixedOptions[key] === "url" && (
                <input
                  type="url"
                  value={mixedUrls[key]}
                  onChange={(e) => setMixedUrls((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={`https://yourstore.myshopify.com${POLICY_PATHS[key]}`}
                  className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
                />
              )}

              {mixedOptions[key] === "upload" && (
                uploadedFiles[key] ? (
                  <div className="flex items-center gap-3 p-3 bg-[#F0FDF4] border border-[#BBF7D0] rounded-lg">
                    <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0" />
                    <p className="text-[#15803D] flex-1 truncate" style={{ fontSize: 14 }}>
                      {uploadedFiles[key]!.url.split("/").pop()}
                    </p>
                    <button
                      onClick={() => setUploadedFiles((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                      className="text-xs text-[#6D7175] hover:text-[#202223]"
                    >
                      {t("removeUpload")}
                    </button>
                  </div>
                ) : (
                  <label className="block border-2 border-dashed border-[#C9CCCF] rounded-lg p-6 text-center hover:border-[#1D4ED8] hover:bg-[#F7F8FA] transition-all cursor-pointer">
                    <Upload className="w-8 h-8 text-[#6D7175] mx-auto mb-2" />
                    <p className="text-[#202223] mb-1" style={{ fontWeight: 500, fontSize: 14 }}>{t("uploadCta")}</p>
                    <p className="text-[#6D7175]" style={{ fontSize: 12 }}>{t("uploadHintExtended")}</p>
                    {uploadLoading[key] && (
                      <p className="text-[#1D4ED8] mt-2" style={{ fontSize: 12 }}>Uploading…</p>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,.txt,.md"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(key, file);
                      }}
                    />
                  </label>
                )
              )}

              {mixedOptions[key] === "template" && (
                <div className="space-y-3">
                  <div className="bg-[#F7F8FA] rounded-lg p-3 text-xs text-[#6D7175]">
                    {meta[key].desc}
                  </div>
                  <button
                    onClick={() => openPreview(key)}
                    className="w-full px-4 py-2 bg-[#F7F8FA] hover:bg-[#E1E3E5] border border-[#E1E3E5] text-sm text-[#202223] rounded-lg transition-colors"
                    style={{ fontWeight: 600 }}
                  >
                    {t("previewTemplateBtn")}
                  </button>
                </div>
              )}
            </div>
          ))}

          <div className="bg-[#F7F8FA] border border-[#E1E3E5] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-[#6D7175] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[#202223] mb-1" style={{ fontWeight: 600, fontSize: 16 }}>{t("mixedBestTitle")}</p>
                <p className="text-[#6D7175]" style={{ fontSize: 14 }}>{t("mixedBestDesc")}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview modal ── */}
      {previewKey && (
        <div className="fixed inset-0 bg-[#0B1220]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E1E3E5]">
              <div>
                <h3 className="text-[#202223]" style={{ fontWeight: 600, fontSize: 18 }}>{meta[previewKey].title}</h3>
                <p className="text-[#6D7175] mt-0.5" style={{ fontSize: 12 }}>{t("templatePreviewTitle")}</p>
              </div>
              <button
                onClick={() => setPreviewKey(null)}
                className="p-2 hover:bg-[#F7F8FA] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#6D7175]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {previewLoading ? (
                <div className="flex items-center justify-center h-32 text-sm text-[#6D7175]">
                  Loading template…
                </div>
              ) : previewEditing ? (
                <textarea
                  value={previewContent}
                  onChange={(e) => setPreviewContent(e.target.value)}
                  className="w-full min-h-[50vh] p-4 border border-[#E1E3E5] rounded-lg text-sm text-[#202223] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent resize-y"
                />
              ) : (
                <div className="prose prose-sm max-w-none">
                  <div className="text-sm text-[#202223] leading-relaxed whitespace-pre-wrap">
                    {previewContent}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-[#E1E3E5] bg-[#F7F8FA]">
              <p className="text-[#6D7175]" style={{ fontSize: 12 }}>{t("previewEditNote")}</p>
              <div className="flex gap-3">
                {previewEditing ? (
                  <>
                    <button
                      onClick={() => {
                        setPreviewContent(previewOriginal);
                        setPreviewEditing(false);
                      }}
                      className="px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-white transition-colors"
                    >
                      {tCommon("cancel")}
                    </button>
                    <button
                      onClick={() => {
                        if (previewKey) {
                          setTemplateDrafts((prev) => ({ ...prev, [previewKey]: previewContent }));
                          setPreviewOriginal(previewContent);
                        }
                        setPreviewEditing(false);
                      }}
                      className="px-4 py-2 bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {tCommon("save")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setPreviewEditing(true)}
                    className="px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-white transition-colors"
                  >
                    {t("editTemplateBtn")}
                  </button>
                )}
                <button
                  onClick={() => setPreviewKey(null)}
                  className="px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-white transition-colors"
                >
                  {t("closeBtn")}
                </button>
                {(selectedFlow === "mixed" || selectedFlow === "template") && previewKey && (
                  <button
                    onClick={() => {
                      if (selectedFlow === "mixed") {
                        setMixedOptions((prev) => ({ ...prev, [previewKey]: "template" }));
                      } else {
                        setTemplateSelections((prev) => ({ ...prev, [previewKey]: true }));
                      }
                      setPreviewKey(null);
                    }}
                    className="px-4 py-2 bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {t("selectTemplateBtn")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

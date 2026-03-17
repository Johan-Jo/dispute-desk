"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link, FileText, Upload, Zap, CheckCircle2, ArrowLeft, X, Layers, Info } from "lucide-react";
import type { StepId } from "@/lib/setup/types";

type PolicyKey = "shipping" | "refunds" | "terms" | "privacy";
type FlowType = "own" | "template" | "mixed";
type MixedOption = "url" | "upload" | "template";

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

export function BusinessPoliciesStep({ stepId, onSaveRef }: BusinessPoliciesStepProps) {
  const t = useTranslations("setup.policies");
  const [showTemplateEditorNotice, setShowTemplateEditorNotice] = useState(false);

  const [selectedFlow, setSelectedFlow] = useState<FlowType | null>(null);
  const [resolvedShopId, setResolvedShopId] = useState<string | null>(null);

  const [ownUrls, setOwnUrls] = useState<Record<PolicyKey, string>>({
    shipping: "", refunds: "", terms: "", privacy: "",
  });

  const [mixedOptions, setMixedOptions] = useState<Record<PolicyKey, MixedOption>>({
    shipping: "template", refunds: "template", terms: "template", privacy: "template",
  });
  const [mixedUrls, setMixedUrls] = useState<Record<PolicyKey, string>>({
    shipping: "", refunds: "", terms: "", privacy: "",
  });
  const [uploadedFiles, setUploadedFiles] = useState<Partial<Record<PolicyKey, { id: string; url: string }>>>({});
  const [uploadLoading, setUploadLoading] = useState<Partial<Record<PolicyKey, boolean>>>({});

  const [previewKey, setPreviewKey] = useState<PolicyKey | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

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
      setPreviewContent("");
      setPreviewLoading(true);
      try {
        const qs = resolvedShopId ? `?shop_id=${resolvedShopId}` : "";
        const res = await fetch(`/api/policy-templates/${key}/content${qs}`);
        if (res.ok) {
          const { body } = (await res.json()) as { body?: string };
          setPreviewContent(body ?? "");
        }
      } catch {}
      setPreviewLoading(false);
    },
    [resolvedShopId]
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
          ? POLICY_KEYS
          : selectedFlow === "mixed"
          ? POLICY_KEYS.filter((k) => mixedOptions[k] === "template")
          : [];

      for (const key of templateKeys) {
        const qs = resolvedShopId ? `?shop_id=${resolvedShopId}` : "";
        const contentRes = await fetch(`/api/policy-templates/${key}/content${qs}`);
        if (!contentRes.ok) return false;
        const { body } = (await contentRes.json()) as { body?: string };
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
          payload: { flow: selectedFlow, ownUrls, mixedOptions, mixedUrls, uploadedFiles },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, selectedFlow, ownUrls, mixedOptions, mixedUrls, uploadedFiles, resolvedShopId]);

  const meta: Record<PolicyKey, { title: string; desc: string }> = {
    shipping: { title: t("shippingTitle"), desc: t("shippingDesc") },
    refunds:  { title: t("refundsTitle"),  desc: t("refundsDesc") },
    terms:    { title: t("termsTitle"),    desc: t("termsDesc") },
    privacy:  { title: t("privacyTitle"), desc: t("privacyDesc") },
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* ── Flow selection ── */}
      {!selectedFlow && (
        <div>
          <div className="flex flex-col items-center text-center mb-10">
            <div className="w-16 h-16 rounded-[14px] bg-[#D89A2B] flex items-center justify-center mb-5">
              <FileText className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-[26px] leading-[34px] font-bold text-[#202223] mb-2">{t("title")}</h2>
            <p className="text-[15px] leading-[24px] text-[#6D7175]">{t("flowSelectSubtitle")}</p>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8">
            <button
              onClick={() => setSelectedFlow("own")}
              className="bg-white border border-[#E1E3E5] hover:border-[#1D4ED8] rounded-[16px] px-8 py-7 text-center transition-all group flex flex-col items-center min-h-[172px]"
            >
              <div className="w-14 h-14 rounded-[12px] bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center transition-colors mb-7">
                <Link className="w-7 h-7 text-[#8C9196] group-hover:text-[#1D4ED8]" />
              </div>
              <h3 className="text-[16px] leading-[24px] font-bold text-[#202223] mb-1.5">{t("ownFlowTitle")}</h3>
              <p className="text-[14px] leading-[20px] text-[#6D7175]">{t("ownFlowShortDesc")}</p>
            </button>

            <button
              onClick={() => setSelectedFlow("template")}
              className="bg-white border border-[#E1E3E5] hover:border-[#1D4ED8] rounded-[16px] px-8 py-7 text-center transition-all group flex flex-col items-center min-h-[172px]"
            >
              <div className="w-14 h-14 rounded-[12px] bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center transition-colors mb-7">
                <Zap className="w-7 h-7 text-[#8C9196] group-hover:text-[#1D4ED8]" />
              </div>
              <h3 className="text-[16px] leading-[24px] font-bold text-[#202223] mb-1.5">{t("templateFlowTitle")}</h3>
              <p className="text-[14px] leading-[20px] text-[#6D7175]">{t("templateFlowShortDesc")}</p>
            </button>

            <button
              onClick={() => setSelectedFlow("mixed")}
              className="bg-white border border-[#E1E3E5] hover:border-[#1D4ED8] rounded-[16px] px-8 py-7 text-center transition-all group flex flex-col items-center min-h-[172px]"
            >
              <div className="w-14 h-14 rounded-[12px] bg-[#F3F4F6] group-hover:bg-[#EFF6FF] flex items-center justify-center transition-colors mb-7">
                <Layers className="w-7 h-7 text-[#8C9196] group-hover:text-[#1D4ED8]" />
              </div>
              <h3 className="text-[16px] leading-[24px] font-bold text-[#202223] mb-1.5">{t("mixedFlowTitle")}</h3>
              <p className="text-[14px] leading-[20px] text-[#6D7175]">{t("mixedFlowShortDesc")}</p>
            </button>
          </div>

          <div className="flex items-start gap-3 p-6 border border-[#E5E7EB] rounded-[12px] bg-[#F3F4F6]">
            <Info className="w-5 h-5 text-[#8C9196] flex-shrink-0 mt-[1px]" />
            <div>
              <p className="text-[16px] leading-[24px] font-bold text-[#202223] mb-1">{t("whyPoliciesTitle")}</p>
              <p className="text-[14px] leading-[22px] text-[#6D7175]">{t("whyPoliciesDesc")}</p>
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
            {t("backToFlowSelection")}
          </button>

          <div className="bg-white rounded-xl border border-[#E1E3E5] p-6">
            <h3 className="text-base font-semibold text-[#202223] mb-1">{t("ownFlowTitle")}</h3>
            <p className="text-sm text-[#6D7175] mb-6">{t("ownFlowDesc")}</p>
            <div className="space-y-4">
              {POLICY_KEYS.map((key) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-[#202223] mb-2">
                    {meta[key].title}
                  </label>
                  <input
                    type="url"
                    value={ownUrls[key]}
                    onChange={(e) => setOwnUrls((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={`https://yourstore.myshopify.com${POLICY_PATHS[key]}`}
                    className="w-full px-4 py-2.5 border border-[#C9CCCF] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
                  />
                </div>
              ))}
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
            {t("backToFlowSelection")}
          </button>

          <div className="bg-white rounded-xl border border-[#E1E3E5] p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-base font-semibold text-[#202223] mb-1">{t("templateSelectedTitle")}</h3>
                <p className="text-sm text-[#6D7175]">{t("templateSelectedDesc")}</p>
              </div>
              <CheckCircle2 className="w-6 h-6 text-[#22C55E] flex-shrink-0" />
            </div>

            <div className="space-y-3">
              {POLICY_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-4 bg-[#F7F8FA] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-[#1D4ED8] flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-[#202223]">{meta[key].title}</p>
                      <p className="text-xs text-[#6D7175]">{meta[key].desc}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openPreview(key)}
                      className="px-3 py-1.5 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-xs font-medium text-[#202223] rounded-lg transition-colors"
                    >
                      {t("previewBtn")}
                    </button>
                    <button
                      onClick={() => setShowTemplateEditorNotice(true)}
                      className="px-3 py-1.5 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-xs font-medium text-[#202223] rounded-lg transition-colors"
                    >
                      {t("editTemplateBtn")}
                    </button>
                  </div>
                </div>
              ))}
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
            {t("backToFlowSelection")}
          </button>

          {POLICY_KEYS.map((key) => (
            <div key={key} className="bg-white rounded-xl border border-[#E1E3E5] p-6">
              <h3 className="text-base font-semibold text-[#202223] mb-1">{meta[key].title}</h3>
              <p className="text-sm text-[#6D7175] mb-4">{t("mixedChooseSource")}</p>

              <div className="flex items-center gap-2 mb-4">
                {(["url", "upload", "template"] as MixedOption[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setMixedOptions((prev) => ({ ...prev, [key]: opt }))}
                    className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                      mixedOptions[key] === opt
                        ? "bg-[#1D4ED8] text-white"
                        : "bg-[#F7F8FA] text-[#202223] hover:bg-[#E1E3E5]"
                    }`}
                  >
                    {opt === "url" && <Link className="w-3.5 h-3.5" />}
                    {opt === "upload" && <Upload className="w-3.5 h-3.5" />}
                    {opt === "template" && <Zap className="w-3.5 h-3.5" />}
                    {opt === "url" ? t("optionUrl") : opt === "upload" ? t("optionUpload") : t("optionTemplate")}
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
                    <p className="text-sm text-[#15803D] flex-1 truncate">
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
                    <p className="text-sm font-medium text-[#202223] mb-1">{t("uploadCta")}</p>
                    <p className="text-xs text-[#6D7175]">{t("uploadHint")}</p>
                    {uploadLoading[key] && (
                      <p className="text-xs text-[#1D4ED8] mt-2">Uploading…</p>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc"
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
                  <div className="flex gap-2">
                    <button
                      onClick={() => openPreview(key)}
                      className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                    >
                      {t("previewBtn")}
                    </button>
                    <button
                      onClick={() => setShowTemplateEditorNotice(true)}
                      className="flex-1 px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                    >
                      {t("editTemplateBtn")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Preview modal ── */}
      {previewKey && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E1E3E5]">
              <div>
                <h3 className="text-lg font-semibold text-[#202223]">{meta[previewKey].title}</h3>
                <p className="text-xs text-[#6D7175] mt-0.5">{t("templatePreviewTitle")}</p>
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
              ) : (
                <pre className="text-sm text-[#202223] leading-relaxed whitespace-pre-wrap font-sans">
                  {previewContent}
                </pre>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-[#E1E3E5] bg-[#F7F8FA]">
              <p className="text-xs text-[#6D7175]">{t("previewEditNote")}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setPreviewKey(null)}
                  className="px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-white transition-colors"
                >
                  {t("closeBtn")}
                </button>
                {selectedFlow === "mixed" && (
                  <button
                    onClick={() => {
                      setMixedOptions((prev) => ({ ...prev, [previewKey]: "template" }));
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

      {showTemplateEditorNotice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-[#202223] mb-2">{t("editTemplateBtn")}</h3>
            <p className="text-sm text-[#6D7175] mb-5">{t("templateEditorComingSoon")}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowTemplateEditorNotice(false)}
                className="px-4 py-2 bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-lg text-sm font-medium transition-colors"
              >
                {t("closeBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

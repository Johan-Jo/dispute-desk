"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link, FileText, Upload, Zap, CheckCircle2, ArrowLeft, X } from "lucide-react";
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
    <div className="max-w-2xl mx-auto">
      {/* ── Flow selection ── */}
      {!selectedFlow && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-[#202223] mb-6">{t("flowSelectTitle")}</h2>

          {/* Own */}
          <button
            onClick={() => setSelectedFlow("own")}
            className="w-full bg-white border-2 border-[#E1E3E5] hover:border-[#1D4ED8] rounded-xl p-6 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#EFF6FF] group-hover:bg-[#DBEAFE] flex items-center justify-center transition-colors flex-shrink-0">
                <Link className="w-6 h-6 text-[#1D4ED8]" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[#202223] mb-1">{t("ownFlowTitle")}</h3>
                <p className="text-sm text-[#6D7175] mb-3">{t("ownFlowDesc")}</p>
                <div className="flex items-center gap-2 text-xs text-[#6D7175]">
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">URL Links</span>
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">File Upload</span>
                </div>
              </div>
            </div>
          </button>

          {/* Template */}
          <button
            onClick={() => setSelectedFlow("template")}
            className="w-full bg-white border-2 border-[#E1E3E5] hover:border-[#1D4ED8] rounded-xl p-6 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#F0FDF4] group-hover:bg-[#DCFCE7] flex items-center justify-center transition-colors flex-shrink-0">
                <FileText className="w-6 h-6 text-[#22C55E]" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[#202223] mb-1 flex items-center gap-2">
                  {t("templateFlowTitle")}
                  <span className="px-2 py-0.5 bg-[#22C55E] text-white text-xs font-medium rounded-full">
                    {t("templateFlowBadge")}
                  </span>
                </h3>
                <p className="text-sm text-[#6D7175] mb-3">{t("templateFlowDesc")}</p>
                <div className="flex items-center gap-2 text-xs text-[#6D7175]">
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">Quick Setup</span>
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">Editable</span>
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">Best Practice</span>
                </div>
              </div>
            </div>
          </button>

          {/* Mixed */}
          <button
            onClick={() => setSelectedFlow("mixed")}
            className="w-full bg-white border-2 border-[#E1E3E5] hover:border-[#1D4ED8] rounded-xl p-6 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#FEF3C7] group-hover:bg-[#FEF08A] flex items-center justify-center transition-colors flex-shrink-0">
                <Zap className="w-6 h-6 text-[#F59E0B]" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[#202223] mb-1">{t("mixedFlowTitle")}</h3>
                <p className="text-sm text-[#6D7175] mb-3">{t("mixedFlowDesc")}</p>
                <div className="flex items-center gap-2 text-xs text-[#6D7175]">
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">Flexible</span>
                  <span className="px-2 py-1 bg-[#F7F8FA] rounded">Customizable</span>
                </div>
              </div>
            </div>
          </button>
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
                  <button
                    onClick={() => openPreview(key)}
                    className="px-3 py-1.5 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-xs font-medium text-[#202223] rounded-lg transition-colors flex-shrink-0"
                  >
                    {t("previewBtn")}
                  </button>
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
                  <button
                    onClick={() => openPreview(key)}
                    className="w-full px-4 py-2 bg-white hover:bg-[#F7F8FA] border border-[#E1E3E5] text-sm font-medium text-[#202223] rounded-lg transition-colors"
                  >
                    {t("previewBtn")}
                  </button>
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
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  FileText,
  Globe,
  CheckCircle2,
  Package,
  MessageSquare,
  Clock,
  Download,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface TemplateCard {
  id: string;
  slug: string;
  dispute_type: string;
  is_recommended: boolean;
  nameKey: string;
  bestForKey: string;
  requiredDocs: number;
  optionalDocs: number;
  keyEvidence: string[];
}

const CATEGORY_KEYS = [
  { value: "", labelKey: "all" },
  { value: "FRAUD", labelKey: "catFraud" },
  { value: "PNR", labelKey: "catPNR" },
  { value: "NOT_AS_DESCRIBED", labelKey: "catNotAsDescribed" },
  { value: "SUBSCRIPTION", labelKey: "catSubscription" },
  { value: "REFUND", labelKey: "catRefund" },
  { value: "DUPLICATE", labelKey: "catDuplicate" },
  { value: "DIGITAL", labelKey: "catDigital" },
  { value: "GENERAL", labelKey: "catGeneral" },
] as const;

const DISPUTE_TYPE_LABEL_KEYS: Record<string, string> = {
  FRAUD: "catFraud",
  PNR: "catPNR",
  NOT_AS_DESCRIBED: "catNotAsDescribed",
  SUBSCRIPTION: "catSubscription",
  REFUND: "catRefund",
  DUPLICATE: "catDuplicate",
  DIGITAL: "catDigital",
  GENERAL: "catGeneral",
};

const EVIDENCE_ICONS: Record<string, React.ReactNode> = {
  evTracking: <Package className="w-3 h-3" />,
  evPolicyLinks: <FileText className="w-3 h-3" />,
  evCustomerComms: <MessageSquare className="w-3 h-3" />,
  evTimeline: <Clock className="w-3 h-3" />,
  evVerification: <CheckCircle2 className="w-3 h-3" />,
  evIPLogs: <Globe className="w-3 h-3" />,
  evDeviceData: <Globe className="w-3 h-3" />,
  evProductPhotos: <FileText className="w-3 h-3" />,
  evDescription: <FileText className="w-3 h-3" />,
  evActivityLogs: <Clock className="w-3 h-3" />,
  evAccessLogs: <Clock className="w-3 h-3" />,
  evIPData: <Globe className="w-3 h-3" />,
  evDownloadProof: <Download className="w-3 h-3" />,
  evRefundProof: <FileText className="w-3 h-3" />,
  evBankRecords: <FileText className="w-3 h-3" />,
  evOrderDetails: <FileText className="w-3 h-3" />,
  evErrorLogs: <FileText className="w-3 h-3" />,
};

const DEMO_TEMPLATES: TemplateCard[] = [
  { id: "TPL-001", slug: "pnr_with_tracking", dispute_type: "PNR", is_recommended: true, nameKey: "tpl1Name", bestForKey: "tpl1BestFor", requiredDocs: 4, optionalDocs: 2, keyEvidence: ["evTracking", "evPolicyLinks", "evCustomerComms", "evTimeline"] },
  { id: "TPL-002", slug: "fraud_standard", dispute_type: "FRAUD", is_recommended: true, nameKey: "tpl2Name", bestForKey: "tpl2BestFor", requiredDocs: 6, optionalDocs: 3, keyEvidence: ["evVerification", "evIPLogs", "evDeviceData", "evTimeline"] },
  { id: "TPL-003", slug: "not_as_described_quality", dispute_type: "NOT_AS_DESCRIBED", is_recommended: true, nameKey: "tpl3Name", bestForKey: "tpl3BestFor", requiredDocs: 5, optionalDocs: 2, keyEvidence: ["evProductPhotos", "evPolicyLinks", "evCustomerComms", "evDescription"] },
  { id: "TPL-004", slug: "subscription_canceled", dispute_type: "SUBSCRIPTION", is_recommended: true, nameKey: "tpl4Name", bestForKey: "tpl4BestFor", requiredDocs: 5, optionalDocs: 3, keyEvidence: ["evPolicyLinks", "evCustomerComms", "evActivityLogs", "evTimeline"] },
  { id: "TPL-005", slug: "digital_goods", dispute_type: "DIGITAL", is_recommended: false, nameKey: "tpl5Name", bestForKey: "tpl5BestFor", requiredDocs: 4, optionalDocs: 1, keyEvidence: ["evAccessLogs", "evIPData", "evDownloadProof", "evTimeline"] },
  { id: "TPL-006", slug: "credit_not_processed", dispute_type: "REFUND", is_recommended: false, nameKey: "tpl6Name", bestForKey: "tpl6BestFor", requiredDocs: 3, optionalDocs: 2, keyEvidence: ["evRefundProof", "evBankRecords", "evCustomerComms", "evTimeline"] },
  { id: "TPL-007", slug: "general_catchall", dispute_type: "GENERAL", is_recommended: false, nameKey: "tpl7Name", bestForKey: "tpl7BestFor", requiredDocs: 3, optionalDocs: 1, keyEvidence: ["evOrderDetails", "evCustomerComms", "evTimeline"] },
  { id: "TPL-008", slug: "duplicate_incorrect", dispute_type: "DUPLICATE", is_recommended: false, nameKey: "tpl8Name", bestForKey: "tpl8BestFor", requiredDocs: 4, optionalDocs: 2, keyEvidence: ["evRefundProof", "evBankRecords", "evErrorLogs", "evTimeline"] },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  shopId: string;
  locale: string;
  onInstalled: (packId: string) => void;
}

export function TemplateLibraryModal({
  isOpen,
  onClose,
  shopId,
  locale,
  onInstalled,
}: Props) {
  const t = useTranslations("templateLibrary");

  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("recommended");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [installedPackIds, setInstalledPackIds] = useState<Record<string, string>>({});
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [isInstallingBulk, setIsInstallingBulk] = useState(false);
  const [showInstalledBanner, setShowInstalledBanner] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ locale });
      if (category) params.set("category", category);

      const res = await fetch(`/api/templates?${params}`);
      if (res.ok) {
        const data = await res.json();
        const live = data.templates ?? [];
        if (live.length > 0) {
          setTemplates(live);
          setLoading(false);
          return;
        }
      }
    } catch {
      /* fallback to demo */
    }

    setTemplates(DEMO_TEMPLATES);
    setLoading(false);
  }, [locale, category]);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      setInstalledIds([]);
      setInstalledPackIds({});
      setPreviewTemplateId(null);
      setSearchQuery("");
      setShowInstalledBanner(false);
      setInstallError(null);
    }
  }, [isOpen, fetchTemplates]);

  const recommendedCount = templates.filter((tpl) => tpl.is_recommended).length;

  const filtered = templates.filter((tpl) => {
    const matchesCategory = !category || tpl.dispute_type === category;
    const name = t(tpl.nameKey);
    const matchesSearch =
      !searchQuery ||
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.dispute_type.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "recommended") {
      return (b.is_recommended ? 1 : 0) - (a.is_recommended ? 1 : 0);
    }
    return 0;
  });

  const handleInstall = async (templateId: string) => {
    setInstalling(templateId);
    setInstallError(null);

    if (!shopId) {
      setTimeout(() => {
        setInstalling(null);
        setInstalledIds((prev) => [...prev, templateId]);
      }, 600);
      return;
    }

    try {
      const res = await fetch(`/api/templates/${templateId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId }),
      });

      if (res.ok) {
        const pack = await res.json();
        setInstalledIds((prev) => [...prev, templateId]);
        setInstalledPackIds((prev) => ({ ...prev, [templateId]: pack.id }));
        onInstalled(pack.id);
      } else {
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data?.error === "string"
            ? data.error
            : res.status === 500
              ? "Template could not be installed. It may not exist in this environment."
              : `Install failed (${res.status}).`;
        setInstallError(message);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Network error. Try again.");
    } finally {
      setInstalling(null);
    }
  };

  const handleInstallRecommended = () => {
    setIsInstallingBulk(true);
    const recommended = templates.filter((tpl) => tpl.is_recommended);
    setTimeout(() => {
      setInstalledIds((prev) => [...prev, ...recommended.map((tpl) => tpl.id)]);
      setIsInstallingBulk(false);
      setShowInstalledBanner(true);
    }, 1200);
  };

  const previewTpl = previewTemplateId
    ? sorted.find((p) => p.id === previewTemplateId)
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("title")}
      description={t("subtitle")}
      size="xl"
    >
      <div className="space-y-6">
        {/* Preview panel */}
        {previewTpl && (
          <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-[#0B1220]">
                  {t("preview")}: {t(previewTpl.nameKey)}
                </h3>
                <p className="text-sm text-[#667085] mt-1">
                  {DISPUTE_TYPE_LABEL_KEYS[previewTpl.dispute_type]
                    ? t(DISPUTE_TYPE_LABEL_KEYS[previewTpl.dispute_type])
                    : previewTpl.dispute_type}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewTemplateId(null)}
              >
                ×
              </Button>
            </div>
            <p className="text-sm text-[#667085] mb-3">
              <strong className="text-[#0B1220]">{t("worksBestFor")}</strong>{" "}
              {t(previewTpl.bestForKey)}
            </p>
            <p className="text-sm text-[#667085] mb-3">
              {previewTpl.requiredDocs} {t("required")}, {previewTpl.optionalDocs}{" "}
              {t("optional")}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {previewTpl.keyEvidence.map((evKey, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-white text-[#0B1220] rounded text-xs border border-[#E5E7EB]"
                >
                  {EVIDENCE_ICONS[evKey]}
                  {t(evKey)}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPreviewTemplateId(null)}
              >
                {t("closePreview")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setPreviewTemplateId(null);
                  handleInstall(previewTpl.id);
                }}
                disabled={installing === previewTpl.id}
              >
                {installing === previewTpl.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : null}
                {t("install")}
              </Button>
            </div>
          </div>
        )}

        {/* Installed Banner */}
        {showInstalledBanner && (
          <div className="bg-[#DCFCE7] border border-[#BBF7D0] rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#0B1220]">
                {t("installedBanner")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-[#22C55E] hover:text-[#16a34a] p-0 h-auto font-medium"
              onClick={() => {
                onClose();
              }}
            >
              {t("goToPacks")}
            </Button>
          </div>
        )}

        {/* Install error */}
        {installError && (
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-lg p-4 flex items-start justify-between gap-3">
            <p className="text-sm text-[#B91C1C]">{installError}</p>
            <button
              type="button"
              onClick={() => setInstallError(null)}
              className="text-[#B91C1C] hover:underline shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Controls */}
        <div className="space-y-4">
          {/* Search & Actions */}
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#667085]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full pl-10 pr-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent text-sm"
              />
            </div>
            <div className="flex gap-3">
              {/* Sort */}
              <div className="min-w-[140px]">
                <label className="text-xs font-medium text-[#667085] mb-1 block">
                  {t("sortBy")}
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent bg-white text-sm"
                >
                  <option value="recommended">{t("sortRecommended")}</option>
                  <option value="most-used">{t("sortMostUsed")}</option>
                  <option value="new">{t("sortNew")}</option>
                </select>
              </div>

              {/* Install Recommended */}
              <div className="min-w-[180px]">
                <label className="text-xs font-medium text-transparent mb-1 block select-none">
                  _
                </label>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleInstallRecommended}
                  disabled={isInstallingBulk || showInstalledBanner}
                  className="w-full"
                >
                  {isInstallingBulk
                    ? t("installing")
                    : t("installRecommended", { count: recommendedCount })}
                </Button>
              </div>
            </div>
          </div>

          {/* Category Filters - Horizontal Scroll */}
          <div className="overflow-x-auto -mx-2 px-2">
            <div className="flex gap-2 min-w-max">
              {CATEGORY_KEYS.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                    category === cat.value
                      ? "bg-[#1D4ED8] text-white"
                      : "bg-[#F6F8FB] text-[#667085] hover:bg-[#E5E7EB]"
                  }`}
                >
                  {t(cat.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Templates Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-[#667085] mx-auto mb-3" />
            <h3 className="font-semibold text-[#0B1220] mb-2">
              {t("noTemplatesTitle")}
            </h3>
            <p className="text-sm text-[#667085]">
              {t("noTemplatesDescription")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-2">
            {sorted.map((tpl) => {
              const isInstalled = installedIds.includes(tpl.id);

              return (
                <div
                  key={tpl.id}
                  className="border border-[#E5E7EB] rounded-xl p-5 hover:border-[#1D4ED8]/30 hover:shadow-sm transition-all bg-white"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-[#0B1220]">
                          {t(tpl.nameKey)}
                        </h3>
                        {tpl.is_recommended && (
                          <Badge variant="default" className="text-xs">
                            {t("recommended")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-[#667085]">
                        {DISPUTE_TYPE_LABEL_KEYS[tpl.dispute_type]
                          ? t(DISPUTE_TYPE_LABEL_KEYS[tpl.dispute_type])
                          : tpl.dispute_type}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5 mb-4">
                    {/* Document count */}
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-[#667085]" />
                      <span className="text-[#667085]">
                        <strong className="text-[#0B1220]">
                          {tpl.requiredDocs}
                        </strong>{" "}
                        {t("required")},{" "}
                        <strong className="text-[#0B1220]">
                          {tpl.optionalDocs}
                        </strong>{" "}
                        {t("optional")}
                      </span>
                    </div>

                    {/* Key Evidence */}
                    {tpl.keyEvidence.length > 0 && (
                      <div className="flex items-start gap-2 text-sm">
                        <span className="text-[#667085] font-medium whitespace-nowrap">
                          {t("keyEvidence")}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {tpl.keyEvidence.map((evKey, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F6F8FB] text-[#0B1220] rounded text-xs border border-[#E5E7EB]"
                            >
                              {EVIDENCE_ICONS[evKey]}
                              {t(evKey)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Works best for */}
                    <div className="text-sm text-[#667085]">
                      <strong className="text-[#0B1220]">
                        {t("worksBestFor")}
                      </strong>{" "}
                      {t(tpl.bestForKey)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {isInstalled ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1"
                            disabled
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2 text-[#22C55E]" />
                            {t("installed")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const packId = installedPackIds[tpl.id];
                              if (packId) {
                                onInstalled(packId);
                              } else {
                                window.location.href = "/portal/connect-shopify";
                              }
                            }}
                          >
                            {t("openPack")}
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleInstall(tpl.id)}
                            disabled={installing === tpl.id}
                          >
                            {installing === tpl.id ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-1" />
                            ) : null}
                            {t("install")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPreviewTemplateId(tpl.id)}
                          >
                            {t("preview")}
                          </Button>
                        </>
                      )}
                    </div>
                    {isInstalled && (
                      <p className="text-xs text-[#667085] text-center">
                        {t("installedAsDraft")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

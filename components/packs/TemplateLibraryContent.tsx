"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  FileText,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface TemplateCard {
  id: string;
  slug: string;
  dispute_type: string;
  is_recommended: boolean;
  name?: string;
  works_best_for?: string | null;
  requiredDocs?: number;
  optionalDocs?: number;
  /** Ready-to-render evidence chip labels from the API (already localized). */
  keyEvidence?: string[];
}

/**
 * Category tabs. `value` is the canonical `pack_templates.dispute_type`
 * code (see `lib/rules/disputeTypes.ts`) — the same vocabulary the DB and
 * the `/api/templates` filter use, so a tab always matches real rows.
 */
export const CATEGORY_KEYS = [
  { value: "", labelKey: "all" },
  { value: "FRAUDULENT", labelKey: "catFraud" },
  { value: "PRODUCT_NOT_RECEIVED", labelKey: "catPNR" },
  { value: "PRODUCT_UNACCEPTABLE", labelKey: "catNotAsDescribed" },
  { value: "SUBSCRIPTION_CANCELLED", labelKey: "catSubscription" },
  { value: "CREDIT_NOT_PROCESSED", labelKey: "catRefund" },
  { value: "DUPLICATE", labelKey: "catDuplicate" },
  { value: "DIGITAL", labelKey: "catDigital" },
  { value: "GENERAL", labelKey: "catGeneral" },
] as const;

export const DISPUTE_TYPE_LABEL_KEYS: Record<string, string> = {
  FRAUDULENT: "catFraud",
  PRODUCT_NOT_RECEIVED: "catPNR",
  PRODUCT_UNACCEPTABLE: "catNotAsDescribed",
  SUBSCRIPTION_CANCELLED: "catSubscription",
  CREDIT_NOT_PROCESSED: "catRefund",
  DUPLICATE: "catDuplicate",
  DIGITAL: "catDigital",
  GENERAL: "catGeneral",
};

export interface TemplateLibraryContentProps {
  shopId: string;
  locale: string;
  onInstalled: (packId: string) => void;
  /** When provided (e.g. on page), show "Back to Evidence Packs" and call when "Go to Packs" is clicked in banner */
  onGoToPacks?: () => void;
  /** When provided (page mode), show back link at top */
  onBack?: () => void;
  /** When false (modal), only fetch when parent opens; when true or undefined (page), fetch on mount */
  isActive?: boolean;
  /** 'page' = back link + full-height grid; 'modal' = constrained grid */
  layoutMode?: "modal" | "page";
  /** Pre-select a dispute-type filter (canonical `dispute_type` code,
   *  e.g. "FRAUDULENT" — see `lib/rules/disputeTypes.ts`) when opening. */
  initialCategory?: string;
  /** When true, installed templates are created ACTIVE (not DRAFT) so they
   *  immediately count as coverage. Used by the Automation/Coverage "Install
   *  Playbook" flows where the merchant expects install = active. Defaults to
   *  false (the plain library-browse behavior, where activation is a later
   *  explicit step). */
  activateOnInstall?: boolean;
}

export function TemplateLibraryContent({
  shopId,
  locale,
  onInstalled,
  onGoToPacks,
  onBack,
  isActive = true,
  layoutMode = "modal",
  initialCategory = "",
  activateOnInstall = false,
}: TemplateLibraryContentProps) {
  const t = useTranslations("templateLibrary");

  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [category, setCategory] = useState(initialCategory);
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
    setLoadError(false);
    try {
      const params = new URLSearchParams({ locale });
      if (category) params.set("category", category);
      const res = await fetch(`/api/templates?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      } else {
        setTemplates([]);
        setLoadError(true);
      }
    } catch {
      setTemplates([]);
      setLoadError(true);
    }
    setLoading(false);
  }, [locale, category]);

  useEffect(() => {
    if (isActive) {
      fetchTemplates();
      setInstalledIds([]);
      setInstalledPackIds({});
      setPreviewTemplateId(null);
      setSearchQuery("");
      setShowInstalledBanner(false);
      setInstallError(null);
      setLoadError(false);
    }
  }, [isActive, fetchTemplates]);

  const recommendedCount = templates.filter((tpl) => tpl.is_recommended).length;
  const filtered = templates.filter((tpl) => {
    const matchesCategory = !category || tpl.dispute_type === category;
    const name = tpl.name ?? tpl.slug ?? "";
    const matchesSearch =
      !searchQuery ||
      (typeof name === "string" && name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (tpl.dispute_type ?? "").toLowerCase().includes(searchQuery.toLowerCase());
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
        body: JSON.stringify({ shopId, activate: activateOnInstall }),
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

  const handleInstallRecommended = async () => {
    setIsInstallingBulk(true);
    setInstallError(null);
    const recommended = templates.filter((tpl) => tpl.is_recommended);
    if (!shopId) {
      setTimeout(() => {
        setInstalledIds((prev) => [...prev, ...recommended.map((tpl) => tpl.id)]);
        setIsInstallingBulk(false);
        setShowInstalledBanner(true);
      }, 1200);
      return;
    }
    const newPackIds: Record<string, string> = {};
    for (const tpl of recommended) {
      try {
        const res = await fetch(`/api/templates/${tpl.id}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopId, activate: activateOnInstall }),
        });
        if (res.ok) {
          const pack = await res.json();
          newPackIds[tpl.id] = pack.id;
          setInstalledIds((prev) => [...prev, tpl.id]);
          setInstalledPackIds((prev) => ({ ...prev, [tpl.id]: pack.id }));
        } else {
          const data = await res.json().catch(() => ({}));
          const message =
            typeof data?.error === "string"
              ? data.error
              : `Install failed for ${tpl.name ?? tpl.slug ?? tpl.id} (${res.status}).`;
          setInstallError(message);
          break;
        }
      } catch (err) {
        setInstallError(err instanceof Error ? err.message : "Network error. Try again.");
        break;
      }
    }
    if (Object.keys(newPackIds).length > 0) {
      setShowInstalledBanner(true);
    }
    setIsInstallingBulk(false);
  };

  const previewTpl = previewTemplateId ? sorted.find((p) => p.id === previewTemplateId) : null;
  const goToPacksHandler = onGoToPacks ?? onBack;

  return (
    <div className="space-y-6">
      {/* Preview panel */}
      {previewTpl && (
        <div className="bg-[#F6F8FB] border border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-[#0B1220]">
                {t("preview")}: {previewTpl.name ?? previewTpl.slug ?? ""}
              </h3>
              <p className="text-sm text-[#667085] mt-1">
                {DISPUTE_TYPE_LABEL_KEYS[previewTpl.dispute_type]
                  ? t(DISPUTE_TYPE_LABEL_KEYS[previewTpl.dispute_type])
                  : previewTpl.dispute_type}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreviewTemplateId(null)}>×</Button>
          </div>
          {previewTpl.works_best_for && (
            <p className="text-sm text-[#667085] mb-3">
              <strong className="text-[#0B1220]">{t("worksBestFor")}</strong>{" "}
              {previewTpl.works_best_for}
            </p>
          )}
          <p className="text-sm text-[#667085] mb-3">
            {previewTpl.requiredDocs ?? 0} {t("required")}, {previewTpl.optionalDocs ?? 0} {t("optional")}
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(previewTpl.keyEvidence ?? []).map((label, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white text-[#0B1220] rounded text-xs border border-[#E5E7EB]"
              >
                <FileText className="w-3 h-3" />
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPreviewTemplateId(null)}>
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
              {installing === previewTpl.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
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
            <p className="text-sm font-medium text-[#0B1220]">{t("installedBanner")}</p>
          </div>
          {goToPacksHandler && (
            <Button
              variant="ghost"
              size="sm"
              className="text-[#22C55E] hover:text-[#16a34a] p-0 h-auto font-medium"
              onClick={goToPacksHandler}
            >
              {t("goToPacks")}
            </Button>
          )}
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
            <div className="min-w-[140px]">
              <label className="text-xs font-medium text-[#667085] mb-1 block">{t("sortBy")}</label>
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
            <div className="min-w-[200px]">
              <label className="text-xs font-medium text-transparent mb-1 block select-none">_</label>
              <Button
                variant="primary"
                size="sm"
                onClick={handleInstallRecommended}
                disabled={isInstallingBulk || showInstalledBanner || recommendedCount === 0}
                className="w-full"
                title={t("installRecommendedHint")}
              >
                {isInstallingBulk ? t("installing") : t("installRecommended", { count: recommendedCount })}
              </Button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto -mx-2 px-2">
          <div className="flex gap-2 min-w-max">
            {CATEGORY_KEYS.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  category === cat.value ? "bg-[#1D4ED8] text-white" : "bg-[#F6F8FB] text-[#667085] hover:bg-[#E5E7EB]"
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
            {loadError ? t("loadErrorTitle") : t("noTemplatesTitle")}
          </h3>
          <p className="text-sm text-[#667085] mb-4">
            {loadError ? t("loadErrorDescription") : t("noTemplatesDescription")}
          </p>
          {loadError && (
            <Button variant="secondary" size="sm" onClick={fetchTemplates}>
              {t("retry")}
            </Button>
          )}
        </div>
      ) : (
        <div
          className={
            layoutMode === "page"
              ? "grid grid-cols-1 lg:grid-cols-2 gap-6"
              : "grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-2"
          }
        >
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
                        {tpl.name ?? tpl.slug}
                      </h3>
                      {tpl.is_recommended && (
                        <Badge variant="default" className="text-xs">
                          {t("recommended")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-[#667085]">
                      {DISPUTE_TYPE_LABEL_KEYS[tpl.dispute_type] ? t(DISPUTE_TYPE_LABEL_KEYS[tpl.dispute_type]) : tpl.dispute_type}
                    </p>
                  </div>
                </div>
                <div className="space-y-2.5 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-[#667085]" />
                    <span className="text-[#667085]">
                      <strong className="text-[#0B1220]">{tpl.requiredDocs ?? 0}</strong> {t("required")},{" "}
                      <strong className="text-[#0B1220]">{tpl.optionalDocs ?? 0}</strong> {t("optional")}
                    </span>
                  </div>
                  {(tpl.keyEvidence ?? []).length > 0 && (
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-[#667085] font-medium whitespace-nowrap">{t("keyEvidence")}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(tpl.keyEvidence ?? []).map((label, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#F6F8FB] text-[#0B1220] rounded text-xs border border-[#E5E7EB]"
                          >
                            <FileText className="w-3 h-3" />
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {tpl.works_best_for && (
                    <div className="text-sm text-[#667085]">
                      <strong className="text-[#0B1220]">{t("worksBestFor")}</strong>{" "}
                      {tpl.works_best_for}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {isInstalled ? (
                      <>
                        <Button variant="ghost" size="sm" className="flex-1" disabled>
                          <CheckCircle2 className="w-4 h-4 mr-2 text-[#22C55E]" />
                          {t("installed")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const packId = installedPackIds[tpl.id];
                            if (packId) onInstalled(packId);
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
                          {installing === tpl.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                          {t("install")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPreviewTemplateId(tpl.id)}>
                          {t("preview")}
                        </Button>
                      </>
                    )}
                  </div>
                  {isInstalled ? (
                    <p className="text-xs text-[#667085] text-center">{t("installedAsDraft")}</p>
                  ) : (
                    <p className="text-xs text-[#667085] text-center">{t("installHint")}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

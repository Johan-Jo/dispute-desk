"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  Star,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  FileText,
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
  name: string;
  short_description: string;
  works_best_for: string | null;
  preview_note: string | null;
}

interface PreviewSection {
  id: string;
  title_default: string;
  items: {
    id: string;
    item_type: string;
    key: string;
    label_default: string;
    required: boolean;
    guidance_default: string | null;
  }[];
}

interface TemplatePreviewData extends TemplateCard {
  sections: PreviewSection[];
}

const CATEGORIES = [
  { value: "", label: "all" },
  { value: "FRAUD", label: "catFraud" },
  { value: "PNR", label: "catPNR" },
  { value: "NOT_AS_DESCRIBED", label: "catNotAsDescribed" },
  { value: "SUBSCRIPTION", label: "catSubscription" },
  { value: "REFUND", label: "catRefund" },
  { value: "DUPLICATE", label: "catDuplicate" },
  { value: "DIGITAL", label: "catDigital" },
  { value: "GENERAL", label: "catGeneral" },
] as const;

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TemplatePreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ locale });
    if (category) params.set("category", category);

    const res = await fetch(`/api/templates?${params}`);
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
    setLoading(false);
  }, [locale, category]);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      setExpandedId(null);
      setPreview(null);
    }
  }, [isOpen, fetchTemplates]);

  const handleTogglePreview = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setPreview(null);
      return;
    }

    setExpandedId(id);
    setLoadingPreview(true);
    const res = await fetch(`/api/templates/${id}/preview?locale=${locale}`);
    if (res.ok) {
      setPreview(await res.json());
    }
    setLoadingPreview(false);
  };

  const handleInstall = async (templateId: string) => {
    if (!shopId) return;
    setInstalling(templateId);

    const res = await fetch(`/api/templates/${templateId}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopId }),
    });

    if (res.ok) {
      const pack = await res.json();
      onInstalled(pack.id);
    }
    setInstalling(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("title")}
      description={t("subtitle")}
      size="xl"
    >
      <div className="space-y-4">
        {/* Category filters */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                category === cat.value
                  ? "bg-[#1D4ED8] text-white border-[#1D4ED8]"
                  : "bg-white text-[#667085] border-[#E5E7EB] hover:border-[#1D4ED8] hover:text-[#1D4ED8]"
              }`}
            >
              {t(cat.label)}
            </button>
          ))}
        </div>

        {/* Template cards */}
        <div className="max-h-[60vh] overflow-y-auto space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-[#667085]">
              {t("noTemplates")}
            </div>
          ) : (
            templates.map((tpl) => (
              <div
                key={tpl.id}
                className="border border-[#E5E7EB] rounded-xl overflow-hidden"
              >
                {/* Card header */}
                <div className="p-4 flex items-start gap-4">
                  <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                    {tpl.is_recommended ? (
                      <Star className="w-5 h-5 text-[#F59E0B]" />
                    ) : (
                      <FileText className="w-5 h-5 text-[#4F46E5]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-[#0B1220] truncate">
                        {tpl.name}
                      </h3>
                      {tpl.is_recommended && (
                        <Badge variant="success">{t("recommended")}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-[#667085] line-clamp-2">
                      {tpl.short_description}
                    </p>
                    {tpl.works_best_for && (
                      <p className="text-xs text-[#94A3B8] mt-1">
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        {tpl.works_best_for}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTogglePreview(tpl.id)}
                    >
                      {expandedId === tpl.id ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                      {t("preview")}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleInstall(tpl.id)}
                      disabled={installing === tpl.id}
                    >
                      {installing === tpl.id ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      ) : null}
                      {t("install")}
                    </Button>
                  </div>
                </div>

                {/* Expanded preview */}
                {expandedId === tpl.id && (
                  <div className="border-t border-[#E5E7EB] bg-[#F7F8FA] p-4">
                    {loadingPreview ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-[#667085]" />
                      </div>
                    ) : preview ? (
                      <div className="space-y-4">
                        {preview.sections.map((section) => (
                          <div key={section.id}>
                            <h4 className="font-medium text-[#0B1220] text-sm mb-2">
                              {section.title_default}
                            </h4>
                            <ul className="space-y-1.5">
                              {section.items.map((item) => (
                                <li
                                  key={item.id}
                                  className="flex items-start gap-2 text-sm"
                                >
                                  <CheckCircle
                                    className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                                      item.required
                                        ? "text-[#1D4ED8]"
                                        : "text-[#CBD5E1]"
                                    }`}
                                  />
                                  <div>
                                    <span
                                      className={
                                        item.required
                                          ? "text-[#0B1220] font-medium"
                                          : "text-[#667085]"
                                      }
                                    >
                                      {item.label_default}
                                    </span>
                                    {item.required && (
                                      <span className="text-xs text-[#1D4ED8] ml-1">
                                        {t("required")}
                                      </span>
                                    )}
                                    {item.guidance_default && (
                                      <p className="text-xs text-[#94A3B8] mt-0.5">
                                        {item.guidance_default}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

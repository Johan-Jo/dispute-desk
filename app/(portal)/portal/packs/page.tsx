"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus, FileText, Edit, Copy, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar, type FilterOption } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";

interface PackTemplate {
  id: string;
  name: string;
  dispute_type: string;
  description: string | null;
  status: string;
  usage_count: number;
  last_used_at: string | null;
  documents_count: number;
  created_at: string;
}

const DISPUTE_TYPES = [
  "Fraudulent",
  "Product Not Received",
  "Product Unacceptable",
  "Subscription Canceled",
  "Credit Not Processed",
  "General",
] as const;

const TYPE_KEY_MAP: Record<string, string> = {
  Fraudulent: "typeFraudulent",
  "Product Not Received": "typeProductNotReceived",
  "Product Unacceptable": "typeProductUnacceptable",
  "Subscription Canceled": "typeSubscriptionCanceled",
  "Credit Not Processed": "typeCreditNotProcessed",
  General: "typeGeneral",
};

function statusBadgeVariant(status: string): "success" | "warning" | "default" {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  return "default";
}

export default function PacksLibraryPage() {
  const t = useTranslations("packTemplates");
  const tTable = useTranslations("table");
  const locale = useLocale();
  const router = useRouter();

  const [templates, setTemplates] = useState<PackTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<string>(DISPUTE_TYPES[0]);
  const [formDescription, setFormDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const shopId =
    typeof window !== "undefined"
      ? (document.cookie.match(/dd_active_shop=([^;]+)/)?.[1] ??
        document.cookie.match(/active_shop_id=([^;]+)/)?.[1] ??
        "")
      : "";

  const fetchTemplates = useCallback(async () => {
    if (!shopId) return;
    const params = new URLSearchParams({ shopId });
    if (activeFilter !== "all") params.set("status", activeFilter);
    if (searchQuery) params.set("q", searchQuery);

    const res = await fetch(`/api/pack-templates?${params}`);
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
    setLoading(false);
  }, [shopId, activeFilter, searchQuery]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filters: FilterOption[] = [
    { label: t("filterAll"), value: "all", active: activeFilter === "all" },
    { label: t("filterActive"), value: "active", active: activeFilter === "active" },
    { label: t("filterDraft"), value: "draft", active: activeFilter === "draft" },
    { label: t("filterArchived"), value: "archived", active: activeFilter === "archived" },
  ];

  const handleCreate = async () => {
    if (!formName.trim() || !formType) return;
    setCreating(true);
    const res = await fetch("/api/pack-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopId,
        name: formName.trim(),
        disputeType: formType,
        description: formDescription.trim() || null,
      }),
    });
    if (res.ok) {
      setIsCreateOpen(false);
      setFormName("");
      setFormType(DISPUTE_TYPES[0]);
      setFormDescription("");
      await fetchTemplates();
    }
    setCreating(false);
  };

  const handleDuplicate = async (id: string) => {
    await fetch(`/api/pack-templates/${id}/duplicate`, { method: "POST" });
    await fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    await fetch(`/api/pack-templates/${id}`, { method: "DELETE" });
    await fetchTemplates();
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return t("never");
    return new Date(iso).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 sm:p-6 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#0B1220] mb-2">
              {t("title")}
            </h1>
            <p className="text-[#667085]">{t("subtitle")}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("createPack")}
          </Button>
        </div>
      </div>

      {/* Card with filter + table */}
      <div className="mx-4 sm:mx-6 mb-4 sm:mb-6 flex-1 flex flex-col overflow-hidden bg-white rounded-xl border border-[#E5E7EB]">
        <FilterBar
          searchPlaceholder={t("searchPlaceholder")}
          onSearch={(v) => setSearchQuery(v)}
          filters={filters}
          onFilterChange={(v) => setActiveFilter(v)}
          onClearFilters={() => setActiveFilter("all")}
        />

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
            </div>
          ) : templates.length > 0 ? (
            <table className="w-full">
              <thead className="bg-[#F7F8FA] border-b border-[#E5E7EB] sticky top-0">
                <tr>
                  <th className="text-left px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">
                    {t("packName")}
                  </th>
                  <th className="text-left px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider hidden lg:table-cell">
                    {t("type")}
                  </th>
                  <th className="text-left px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider hidden md:table-cell">
                    {t("documents")}
                  </th>
                  <th className="text-left px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider hidden xl:table-cell">
                    {t("usageCount")}
                  </th>
                  <th className="text-left px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider hidden xl:table-cell">
                    {t("lastUsed")}
                  </th>
                  <th className="text-left px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">
                    {tTable("status")}
                  </th>
                  <th className="text-right px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider hidden sm:table-cell">
                    {/* Actions */}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] bg-white">
                {templates.map((tpl) => (
                  <tr
                    key={tpl.id}
                    className="hover:bg-[#F7F8FA] transition-colors cursor-pointer"
                    onClick={() => router.push(`/portal/packs/templates/${tpl.id}`)}
                  >
                    <td className="px-4 sm:px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-[#4F46E5]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-[#0B1220] truncate">
                            {tpl.name}
                          </p>
                          <p className="text-sm text-[#667085]">
                            {tpl.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#0B1220] hidden lg:table-cell">
                      {TYPE_KEY_MAP[tpl.dispute_type]
                        ? t(TYPE_KEY_MAP[tpl.dispute_type])
                        : tpl.dispute_type}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#667085] hidden md:table-cell">
                      {t("nDocs", { count: tpl.documents_count })}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#0B1220] hidden xl:table-cell">
                      {tpl.usage_count}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#667085] hidden xl:table-cell">
                      {formatDate(tpl.last_used_at)}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <Badge variant={statusBadgeVariant(tpl.status)}>
                        {tpl.status === "active"
                          ? t("filterActive")
                          : tpl.status === "draft"
                            ? t("filterDraft")
                            : t("filterArchived")}
                      </Badge>
                    </td>
                    <td className="px-4 sm:px-6 py-4 hidden sm:table-cell">
                      <div
                        className="flex items-center justify-end gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            router.push(`/portal/packs/${tpl.id}?type=template`)
                          }
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDuplicate(tpl.id)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(tpl.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-[#F7F8FA] flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-[#667085]" />
              </div>
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">
                {t("emptyTitle")}
              </h3>
              <p className="text-sm text-[#667085] mb-4 max-w-md">
                {t("emptyDescription")}
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("createPack")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Create Pack Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title={t("modalTitle")}
        description={t("modalDescription")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating || !formName.trim()}
            >
              {t("create")}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-[#0B1220] mb-2">
              {t("nameLabel")} *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0B1220] mb-2">
              {t("typeLabel")} *
            </label>
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
              className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            >
              {DISPUTE_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {TYPE_KEY_MAP[dt] ? t(TYPE_KEY_MAP[dt]) : dt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#0B1220] mb-2">
              {t("descriptionLabel")}
            </label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              rows={4}
              className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent resize-none"
            />
          </div>

          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
            <p className="text-sm text-[#1D4ED8]">
              <strong>Next steps:</strong> {t("nextSteps")}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus, FileText, Edit, Trash2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterBar, type FilterOption } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import { TemplateLibraryModal } from "@/components/packs/TemplateLibraryModal";

interface PackRow {
  id: string;
  name: string;
  code: string | null;
  dispute_type: string;
  status: string;
  source: string;
  template_id: string | null;
  documents_count: number;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
}

const DISPUTE_TYPES = [
  "FRAUD",
  "PNR",
  "NOT_AS_DESCRIBED",
  "SUBSCRIPTION",
  "REFUND",
  "DUPLICATE",
  "DIGITAL",
  "GENERAL",
] as const;

const TYPE_LABELS: Record<string, string> = {
  FRAUD: "typeFraudulent",
  PNR: "typeProductNotReceived",
  NOT_AS_DESCRIBED: "typeProductUnacceptable",
  SUBSCRIPTION: "typeSubscriptionCanceled",
  REFUND: "typeCreditNotProcessed",
  DUPLICATE: "typeDuplicate",
  DIGITAL: "typeDigital",
  GENERAL: "typeGeneral",
};

const DEMO_PACKS: PackRow[] = [
  { id: "EP-001", name: "Fraudulent Transaction — Standard", code: "EP-001", dispute_type: "FRAUD", status: "ACTIVE", source: "TEMPLATE", template_id: "tpl-001", documents_count: 8, usage_count: 23, last_used_at: "2026-02-20T00:00:00Z", created_at: "2026-01-10T00:00:00Z" },
  { id: "EP-002", name: "Product Not Received — With Tracking", code: "EP-002", dispute_type: "PNR", status: "ACTIVE", source: "TEMPLATE", template_id: "tpl-002", documents_count: 5, usage_count: 15, last_used_at: "2026-02-18T00:00:00Z", created_at: "2026-01-12T00:00:00Z" },
  { id: "EP-003", name: "Product Unacceptable — Quality Issues", code: "EP-003", dispute_type: "NOT_AS_DESCRIBED", status: "ACTIVE", source: "MANUAL", template_id: null, documents_count: 7, usage_count: 8, last_used_at: "2026-02-15T00:00:00Z", created_at: "2026-01-15T00:00:00Z" },
  { id: "EP-004", name: "Subscription Cancelled — Comprehensive", code: "EP-004", dispute_type: "SUBSCRIPTION", status: "ACTIVE", source: "TEMPLATE", template_id: "tpl-004", documents_count: 6, usage_count: 12, last_used_at: "2026-02-10T00:00:00Z", created_at: "2026-01-18T00:00:00Z" },
  { id: "EP-005", name: "Credit Not Processed — Standard", code: "EP-005", dispute_type: "REFUND", status: "DRAFT", source: "MANUAL", template_id: null, documents_count: 4, usage_count: 5, last_used_at: "2026-02-08T00:00:00Z", created_at: "2026-01-20T00:00:00Z" },
  { id: "EP-006", name: "General Inquiry — Template", code: "EP-006", dispute_type: "GENERAL", status: "DRAFT", source: "MANUAL", template_id: null, documents_count: 3, usage_count: 0, last_used_at: null, created_at: "2026-01-22T00:00:00Z" },
];

function statusBadgeVariant(
  status: string
): "success" | "warning" | "default" {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return "default";
}

export default function PacksLibraryPage() {
  const t = useTranslations("packTemplates");
  const tTable = useTranslations("table");
  const locale = useLocale();
  const router = useRouter();

  const shopId =
    typeof window !== "undefined"
      ? (document.cookie.match(/dd_active_shop=([^;]+)/)?.[1] ??
        document.cookie.match(/active_shop_id=([^;]+)/)?.[1] ??
        "")
      : "";
  const isDemo = !shopId;

  const [packs, setPacks] = useState<PackRow[]>(isDemo ? DEMO_PACKS : []);
  const [loading, setLoading] = useState(!isDemo);
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<string>(DISPUTE_TYPES[0]);
  const [creating, setCreating] = useState(false);

  const fetchPacks = useCallback(async () => {
    if (isDemo) return;
    const params = new URLSearchParams({ shopId });
    if (activeFilter !== "all") params.set("status", activeFilter.toUpperCase());
    if (searchQuery) params.set("q", searchQuery);

    try {
      const res = await fetch(`/api/packs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [isDemo, shopId, activeFilter, searchQuery]);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  const filters: FilterOption[] = [
    { label: t("filterAll"), value: "all", active: activeFilter === "all" },
    {
      label: t("filterActive"),
      value: "active",
      active: activeFilter === "active",
    },
    {
      label: t("filterDraft"),
      value: "draft",
      active: activeFilter === "draft",
    },
    {
      label: t("filterArchived"),
      value: "archived",
      active: activeFilter === "archived",
    },
  ];

  const handleCreateManual = async () => {
    if (!formName.trim() || !formType) return;
    setCreating(true);
    const res = await fetch("/api/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopId,
        name: formName.trim(),
        disputeType: formType,
      }),
    });
    if (res.ok) {
      setIsCreateOpen(false);
      setFormName("");
      setFormType(DISPUTE_TYPES[0]);
      await fetchPacks();
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    await fetch(`/api/packs/${id}`, { method: "DELETE" });
    await fetchPacks();
  };

  const handleTemplateInstalled = (packId: string) => {
    setIsTemplateLibraryOpen(false);
    router.push(`/portal/packs/${packId}`);
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
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="primary"
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={() => setIsTemplateLibraryOpen(true)}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {t("startFromTemplate")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("createPack")}
            </Button>
          </div>
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
          ) : packs.length > 0 ? (
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
                    {t("source")}
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
                  <th className="text-right px-4 sm:px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider hidden sm:table-cell" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] bg-white">
                {packs.map((pack) => (
                  <tr
                    key={pack.id}
                    className="hover:bg-[#F7F8FA] transition-colors cursor-pointer"
                    onClick={() => router.push(`/portal/packs/${pack.id}`)}
                  >
                    <td className="px-4 sm:px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-[#4F46E5]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-[#0B1220] truncate">
                            {pack.name}
                          </p>
                          <p className="text-sm text-[#667085]">
                            {pack.code ?? pack.id.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#0B1220] hidden lg:table-cell">
                      {TYPE_LABELS[pack.dispute_type]
                        ? t(TYPE_LABELS[pack.dispute_type])
                        : pack.dispute_type}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#667085] hidden md:table-cell">
                      <Badge variant={pack.source === "TEMPLATE" ? "info" : "default"}>
                        {pack.source === "TEMPLATE" ? t("sourceTemplate") : t("sourceManual")}
                      </Badge>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#0B1220] hidden xl:table-cell">
                      {pack.usage_count}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-[#667085] hidden xl:table-cell">
                      {formatDate(pack.last_used_at)}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <Badge variant={statusBadgeVariant(pack.status)}>
                        {pack.status === "ACTIVE"
                          ? t("filterActive")
                          : pack.status === "DRAFT"
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
                            router.push(`/portal/packs/${pack.id}`)
                          }
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(pack.id)}
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
                onClick={() => setIsTemplateLibraryOpen(true)}
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {t("startFromTemplate")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Create Pack Modal (manual) */}
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
              onClick={handleCreateManual}
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
                  {TYPE_LABELS[dt] ? t(TYPE_LABELS[dt]) : dt}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg p-4">
            <p className="text-sm text-[#1D4ED8]">
              <strong>Next steps:</strong> {t("nextSteps")}
            </p>
          </div>
        </div>
      </Modal>

      {/* Template Library Modal */}
      <TemplateLibraryModal
        isOpen={isTemplateLibraryOpen}
        onClose={() => setIsTemplateLibraryOpen(false)}
        shopId={shopId}
        locale={locale}
        onInstalled={handleTemplateInstalled}
      />
    </div>
  );
}

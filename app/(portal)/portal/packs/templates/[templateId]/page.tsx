"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  FileText,
  Image,
  FileSpreadsheet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface TemplateDoc {
  id: string;
  name: string;
  file_type: string;
  file_size: string | null;
  required: boolean;
  created_at: string;
}

interface TemplateData {
  id: string;
  name: string;
  dispute_type: string;
  description: string | null;
  status: string;
  usage_count: number;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
  pack_template_documents: TemplateDoc[];
}

function fileIcon(type: string) {
  const t = type.toUpperCase();
  if (t === "PDF") return <FileText className="w-5 h-5 text-[#EF4444]" />;
  if (t === "PNG" || t === "JPG" || t === "JPEG")
    return <Image className="w-5 h-5 text-[#10B981]" />;
  if (t === "CSV" || t === "XLS" || t === "XLSX")
    return <FileSpreadsheet className="w-5 h-5 text-[#10B981]" />;
  return <FileText className="w-5 h-5 text-[#667085]" />;
}

export default function TemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const router = useRouter();
  const t = useTranslations("packTemplates");
  const locale = useLocale();

  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState("PDF");
  const [docSize, setDocSize] = useState("");
  const [docRequired, setDocRequired] = useState(false);

  const fetchTemplate = useCallback(async () => {
    const res = await fetch(`/api/pack-templates/${templateId}`);
    if (res.ok) {
      setTemplate(await res.json());
    }
    setLoading(false);
  }, [templateId]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  const handleDeleteTemplate = async () => {
    if (!confirm(t("confirmDelete"))) return;
    await fetch(`/api/pack-templates/${templateId}`, { method: "DELETE" });
    router.push("/portal/packs");
  };

  const handleDuplicate = async () => {
    const res = await fetch(`/api/pack-templates/${templateId}/duplicate`, {
      method: "POST",
    });
    if (res.ok) {
      const copy = await res.json();
      router.push(`/portal/packs/templates/${copy.id}`);
    }
  };

  const handleAddDoc = async () => {
    if (!docName.trim() || !docType) return;
    await fetch(`/api/pack-templates/${templateId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: docName.trim(),
        fileType: docType,
        fileSize: docSize.trim() || null,
        required: docRequired,
      }),
    });
    setIsAddDocOpen(false);
    setDocName("");
    setDocType("PDF");
    setDocSize("");
    setDocRequired(false);
    await fetchTemplate();
  };

  const handleDeleteDoc = async (docId: string) => {
    await fetch(`/api/pack-templates/${templateId}/documents/${docId}`, {
      method: "DELETE",
    });
    await fetchTemplate();
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return t("never");
    return new Date(iso).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-[#1D4ED8] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-20">
        <p className="text-[#667085]">Template not found</p>
        <button
          onClick={() => router.push("/portal/packs")}
          className="text-[#1D4ED8] hover:underline text-sm mt-2"
        >
          {t("detailBack")}
        </button>
      </div>
    );
  }

  const docs = template.pack_template_documents ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-[1200px] mx-auto">
      {/* Back nav */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => router.push("/portal/packs")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t("detailBack")}
        </Button>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-xl sm:text-2xl font-bold text-[#0B1220]">
                {template.name}
              </h1>
              <Badge
                variant={
                  template.status === "active" ? "success" : "warning"
                }
              >
                {template.status === "active"
                  ? t("filterActive")
                  : t("filterDraft")}
              </Badge>
            </div>
            <p className="text-sm sm:text-base text-[#667085]">
              {t("detailCreated", {
                date: formatDate(template.created_at),
                count: template.usage_count,
              })}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
            <Button
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => {
                /* TODO: edit mode */
              }}
            >
              <Edit className="w-4 h-4 mr-2" />
              {t("editPack")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleDeleteTemplate}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t("deletePack")}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pack Details Card */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <h3 className="text-base font-semibold text-[#0B1220]">
                {t("packDetails")}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-[#0B1220] mb-1 block">
                  {t("packNameField")}
                </label>
                <p className="text-[#667085]">{template.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-[#0B1220] mb-1 block">
                  {t("disputeTypeField")}
                </label>
                <p className="text-[#667085]">{template.dispute_type}</p>
              </div>
              {template.description && (
                <div>
                  <label className="text-sm font-medium text-[#0B1220] mb-1 block">
                    {t("descriptionField")}
                  </label>
                  <p className="text-[#667085]">{template.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Documents Card */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E7EB] flex flex-row items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#0B1220]">
                  {t("documents")}
                </h3>
                <p className="text-sm text-[#667085] mt-1">
                  {t("documentsSection", { count: docs.length })}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsAddDocOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("addDocument")}
              </Button>
            </div>
            {docs.length > 0 ? (
              <div className="divide-y divide-[#E5E7EB]">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="px-6 py-4 flex items-center justify-between hover:bg-[#F7F8FA] transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 bg-[#F7F8FA] rounded-lg flex items-center justify-center">
                        {fileIcon(doc.file_type)}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[#0B1220]">
                            {doc.name}
                          </p>
                          {doc.required && (
                            <Badge variant="info">{t("required")}</Badge>
                          )}
                        </div>
                        <p className="text-sm text-[#667085]">
                          {doc.file_type}
                          {doc.file_size ? ` · ${doc.file_size}` : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteDoc(doc.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-[#667085]">
                {t("emptyDescription")}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Usage Statistics */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <h3 className="text-base font-semibold text-[#0B1220]">
                {t("usageStats")}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-[#667085] mb-1">{t("totalUses")}</p>
                <p className="text-2xl font-semibold text-[#0B1220]">
                  {template.usage_count}
                </p>
              </div>
              <div>
                <p className="text-sm text-[#667085] mb-1">
                  {t("lastUsedLabel")}
                </p>
                <p className="font-medium text-[#0B1220]">
                  {formatDate(template.last_used_at)}
                </p>
              </div>
              <div>
                <p className="text-sm text-[#667085] mb-1">{t("createdBy")}</p>
                <p className="font-medium text-[#0B1220]">
                  {template.created_by ?? "Admin"}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E7EB]">
              <h3 className="text-base font-semibold text-[#0B1220]">
                {t("quickActions")}
              </h3>
            </div>
            <div className="p-6 space-y-2">
              <Button
                variant="primary"
                size="sm"
                className="w-full justify-start"
              >
                {t("useThisPack")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={handleDuplicate}
              >
                {t("duplicatePack")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
              >
                {t("exportPack")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Add Document Modal */}
      <Modal
        isOpen={isAddDocOpen}
        onClose={() => setIsAddDocOpen(false)}
        title={t("addDocument")}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsAddDocOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleAddDoc}
              disabled={!docName.trim()}
            >
              {t("addDocument")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#0B1220] mb-2">
              Document Name *
            </label>
            <input
              type="text"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder="e.g., Order Confirmation Email"
              className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-2">
                File Type
              </label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
              >
                <option value="PDF">PDF</option>
                <option value="PNG">PNG</option>
                <option value="JPG">JPG</option>
                <option value="CSV">CSV</option>
                <option value="TXT">TXT</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#0B1220] mb-2">
                File Size
              </label>
              <input
                type="text"
                value={docSize}
                onChange={(e) => setDocSize(e.target.value)}
                placeholder="e.g., 245 KB"
                className="w-full px-4 py-2.5 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={docRequired}
              onChange={(e) => setDocRequired(e.target.checked)}
              className="w-4 h-4 rounded border-[#E5E7EB] text-[#4F46E5] focus:ring-[#4F46E5]"
            />
            <span className="text-sm text-[#0B1220]">{t("required")}</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

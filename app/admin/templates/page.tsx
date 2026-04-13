"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FileText, Edit2, Globe } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface Template {
  id: string;
  name: string;
  slug: string;
  dispute_type: string;
  status: string;
  is_recommended: boolean;
  locale_count: number;
  usage_count: number;
  mapping_count: number;
  updated_at: string;
}

export default function TemplatesAdminPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    fetch(`/api/admin/templates?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setTemplates(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [search, statusFilter]);

  const stats = {
    total: templates.length,
    active: templates.filter((t) => t.status === "active").length,
    recommended: templates.filter((t) => t.is_recommended).length,
    archived: templates.filter((t) => t.status === "archived").length,
  };

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Template Library"
        subtitle="Manage global evidence templates and playbooks"
        icon={FileText}
      />

      <AdminStatsRow
        cards={[
          { label: "Total Templates", value: stats.total },
          { label: "Active", value: stats.active, valueColor: "text-[#22C55E]" },
          { label: "Recommended", value: stats.recommended, valueColor: "text-[#3B82F6]" },
          { label: "Archived", value: stats.archived, valueColor: "text-[#EF4444]" },
        ]}
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search templates..."
        filters={[
          { label: "All", value: "all" },
          { label: "Active", value: "active" },
          { label: "Draft", value: "draft" },
          { label: "Archived", value: "archived" },
        ]}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      <AdminTable
        headers={["Template", "Family", "Status", "Locales", "Mappings", "Last Updated", "Actions"]}
        headerAlign={{ 6: "right" }}
        loading={loading}
        isEmpty={!loading && templates.length === 0}
        emptyTitle="No templates found"
        emptyMessage="Try adjusting your search or filters"
      >
        {templates.map((t) => (
          <tr key={t.id} className="hover:bg-[#F8FAFC] transition-colors">
            <td className="px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
                  <FileText className="w-4 h-4 text-[#1D4ED8]" />
                </div>
                <div>
                  <div className="text-sm font-medium text-[#0F172A] flex items-center gap-2">
                    {t.name}
                    {t.is_recommended && (
                      <span className="px-2 py-0.5 bg-[#DBEAFE] text-[#1E40AF] text-xs font-semibold rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#64748B] font-mono">{t.slug}</div>
                </div>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="px-2.5 py-1 bg-[#F1F5F9] text-[#475569] text-xs font-medium rounded-md">
                {t.dispute_type}
              </span>
            </td>
            <td className="px-6 py-4">
              <StatusPill status={t.status} />
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-[#64748B]" />
                <span className="text-sm text-[#64748B]">{t.locale_count}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#0F172A] font-semibold">{t.mapping_count}</span>
              <span className="text-xs text-[#64748B] ml-1">mappings</span>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#64748B]">
                {new Date(t.updated_at).toLocaleDateString()}
              </span>
            </td>
            <td className="px-6 py-4">
              <div className="flex items-center justify-end gap-2">
                <Link
                  href={`/admin/templates/${t.id}`}
                  className="p-2 text-[#64748B] hover:text-[#1D4ED8] hover:bg-[#EFF6FF] rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </Link>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}

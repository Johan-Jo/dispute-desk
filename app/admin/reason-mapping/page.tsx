"use client";

import { useState, useEffect, useCallback } from "react";
import { GitBranch, Edit2, Search, X } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";
import type { ReasonTemplateMapping, ReasonMappingStats } from "@/lib/types/reasonMapping";

interface Template {
  id: string;
  name: string;
  slug: string;
  status: string;
}

type MappingStatus = "mapped" | "unmapped" | "deprecated-target";

function computeMappingStatus(m: ReasonTemplateMapping): MappingStatus {
  if (!m.template_id) return "unmapped";
  if (m.template_status === "archived") return "deprecated-target";
  return "mapped";
}

export default function ReasonMappingPage() {
  const [mappings, setMappings] = useState<ReasonTemplateMapping[]>([]);
  const [stats, setStats] = useState<ReasonMappingStats>({ total: 0, mapped: 0, unmapped: 0, warnings: 0 });
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"chargeback" | "inquiry">("chargeback");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Template picker state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchMappings = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/reason-mapping?phase=${phase}&stats=true`);
    const data = await res.json();
    setMappings(data.mappings ?? []);
    setStats(data.stats ?? { total: 0, mapped: 0, unmapped: 0, warnings: 0 });
    setLoading(false);
  }, [phase]);

  useEffect(() => {
    fetchMappings();
  }, [fetchMappings]);

  useEffect(() => {
    // Fetch active templates for picker
    fetch("/api/admin/templates?status=active")
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handleAssignTemplate = async (mappingId: string, templateId: string | null) => {
    setSaving(true);
    await fetch(`/api/admin/reason-mapping/${mappingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId }),
    });
    setEditingId(null);
    setSaving(false);
    fetchMappings();
  };

  const filtered = mappings.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !m.label.toLowerCase().includes(q) &&
        !m.reason_code.toLowerCase().includes(q)
      )
        return false;
    }
    if (statusFilter === "mapped" && !m.template_id) return false;
    if (statusFilter === "unmapped" && m.template_id) return false;
    if (statusFilter === "warnings") {
      const ms = computeMappingStatus(m);
      if (ms !== "deprecated-target") return false;
    }
    return true;
  });

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Reason Mapping"
        subtitle="Map Shopify dispute reasons to default evidence templates"
        icon={GitBranch}
        iconGradient="from-[#8B5CF6] to-[#EC4899]"
      />

      {/* Phase Tabs */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-sm font-medium text-[#64748B]">Lifecycle Phase:</span>
        <div className="flex gap-1 bg-[#F1F5F9] rounded-lg p-1">
          <button
            onClick={() => setPhase("chargeback")}
            className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
              phase === "chargeback"
                ? "bg-white text-[#0F172A] shadow-sm"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            Chargeback
          </button>
          <button
            onClick={() => setPhase("inquiry")}
            className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
              phase === "inquiry"
                ? "bg-white text-[#0F172A] shadow-sm"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            Inquiry
          </button>
        </div>
        <span className="text-xs text-[#94A3B8]">
          Showing default template assignments for {phase} disputes
        </span>
      </div>

      {/* Warnings banner */}
      {stats.unmapped > 0 && (
        <div className="mb-6 p-4 bg-[#FEF3C7] border border-[#FDE68A] rounded-lg flex items-center gap-3">
          <div className="w-8 h-8 bg-[#F59E0B] rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">!</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#92400E]">
              {stats.unmapped} unmapped reason{stats.unmapped !== 1 ? "s" : ""} for {phase}
            </p>
            <p className="text-xs text-[#B45309]">
              Disputes with unmapped reasons won&apos;t have a default template. Use the filter below to find them.
            </p>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <AdminStatsRow
        cards={[
          { label: "Total Reasons", value: stats.total },
          { label: "Mapped", value: stats.mapped, valueColor: "text-[#22C55E]" },
          { label: "Unmapped", value: stats.unmapped, valueColor: "text-[#EF4444]" },
          { label: "Warnings", value: stats.warnings, valueColor: "text-[#F59E0B]" },
        ]}
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by reason or label..."
        filters={[
          { label: "All", value: "all" },
          { label: "Mapped", value: "mapped" },
          { label: "Unmapped", value: "unmapped" },
          { label: "Warnings", value: "warnings" },
        ]}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      <AdminTable
        headers={["Shopify Reason", "Label", "Family", "Default Template", "Status", "Last Updated", "Actions"]}
        headerAlign={{ 6: "right" }}
        loading={loading}
        isEmpty={!loading && filtered.length === 0}
        emptyTitle="No mappings found"
        emptyMessage="Try adjusting your search or filters"
      >
        {filtered.map((m) => {
          const ms = computeMappingStatus(m);
          return (
            <tr key={m.id} className="hover:bg-[#F8FAFC] transition-colors">
              <td className="px-6 py-4">
                <span className="text-xs font-mono text-[#64748B]">{m.reason_code}</span>
              </td>
              <td className="px-6 py-4">
                <span className="text-sm font-medium text-[#0F172A]">{m.label}</span>
              </td>
              <td className="px-6 py-4">
                <span className="px-2.5 py-1 bg-[#F1F5F9] text-[#475569] text-xs font-medium rounded-md">
                  {m.family}
                </span>
              </td>
              <td className="px-6 py-4">
                {editingId === m.id ? (
                  <div className="flex items-center gap-2">
                    <select
                      defaultValue={m.template_id ?? ""}
                      onChange={(e) => {
                        const val = e.target.value || null;
                        handleAssignTemplate(m.id, val);
                      }}
                      disabled={saving}
                      className="py-1.5 px-3 border border-[#E2E8F0] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] max-w-[200px]"
                    >
                      <option value="">— None —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 text-[#64748B] hover:text-[#0F172A]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : m.template_name ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#0F172A]">{m.template_name}</span>
                    {m.template_status === "archived" && (
                      <span className="px-2 py-0.5 bg-[#FEE2E2] text-[#991B1B] text-xs font-semibold rounded">
                        Archived
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-[#94A3B8] italic">Not mapped</span>
                )}
              </td>
              <td className="px-6 py-4">
                <StatusPill status={ms} />
              </td>
              <td className="px-6 py-4">
                <span className="text-sm text-[#64748B]">
                  {new Date(m.updated_at).toLocaleDateString()}
                </span>
              </td>
              <td className="px-6 py-4 text-right">
                <button
                  onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#EFF6FF] text-[#1D4ED8] text-sm font-semibold rounded-lg hover:bg-[#DBEAFE] transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {editingId === m.id ? "Cancel" : "Edit Mapping"}
                </button>
              </td>
            </tr>
          );
        })}
      </AdminTable>
    </div>
  );
}

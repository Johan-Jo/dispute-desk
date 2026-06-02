"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Download } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable, type AdminTableHeader } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface Lead {
  id: string;
  email: string;
  source: string | null;
  locale: string | null;
  utm: Record<string, string> | null;
  status: string;
  nurture_step: number;
  created_at: string;
}

interface Stats {
  total: number;
  active: number;
  unsubscribed: number;
  sequenceComplete: number;
  last7d: number;
}

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-[#DCFCE7]", text: "text-[#15803D]" },
  unsubscribed: { bg: "bg-[#F1F5F9]", text: "text-[#64748B]" },
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function utmSummary(utm: Record<string, string> | null): string {
  if (!utm || Object.keys(utm).length === 0) return "—";
  return (
    utm.utm_source ??
    utm.utm_campaign ??
    Object.values(utm)[0] ??
    "—"
  );
}

function toCsv(leads: Lead[]): string {
  const header = "email,source,locale,status,nurture_step,utm,created_at";
  const rows = leads.map((l) => {
    const utm = l.utm ? JSON.stringify(l.utm).replace(/"/g, "'") : "";
    const cells = [
      l.email,
      l.source ?? "",
      l.locale ?? "",
      l.status,
      String(l.nurture_step),
      utm,
      l.created_at,
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    return cells.join(",");
  });
  return [header, ...rows].join("\n");
}

export default function AdminPlaybookLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sequenceLength, setSequenceLength] = useState(5);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/playbook-leads?${params.toString()}`);
      if (!res.ok) {
        setLeads([]);
        return;
      }
      const data = await res.json();
      setLeads(data.leads ?? []);
      setStats(data.stats ?? null);
      if (data.sequenceLength) setSequenceLength(data.sequenceLength);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const id = setTimeout(fetchLeads, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [fetchLeads, search]);

  const downloadCsv = () => {
    const blob = new Blob([toCsv(leads)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playbook-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Playbook Leads"
        subtitle="Inbound campaign — Liability-Shift Playbook signups"
        actions={
          <button
            onClick={downloadCsv}
            disabled={leads.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#0F172A] bg-white border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        }
      />

      <AdminStatsRow
        cards={[
          { label: "Total leads", value: stats?.total ?? 0 },
          { label: "Active", value: stats?.active ?? 0, valueColor: "text-[#22C55E]" },
          { label: "New (7 days)", value: stats?.last7d ?? 0, valueColor: "text-[#2563EB]" },
          { label: "Sequence complete", value: stats?.sequenceComplete ?? 0 },
          { label: "Unsubscribed", value: stats?.unsubscribed ?? 0, valueColor: "text-[#64748B]" },
        ]}
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by email..."
        filters={[
          { label: "All", value: "all" },
          { label: "Active", value: "active" },
          { label: "Unsubscribed", value: "unsubscribed" },
        ]}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      <AdminTable
        headers={
          [
            "Email",
            "Form",
            "Locale",
            "Source",
            "Nurture",
            "Status",
            "Captured",
          ] as AdminTableHeader[]
        }
        loading={loading}
        isEmpty={!loading && leads.length === 0}
        emptyIcon={<Mail className="w-8 h-8 text-[#CBD5E1]" />}
        emptyTitle="No leads yet"
        emptyMessage="Signups from /playbook will appear here"
      >
        {leads.map((l) => (
          <tr key={l.id} className="hover:bg-[#F8FAFC] transition-colors">
            <td className="px-6 py-4">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#64748B]" />
                <span className="text-sm font-medium text-[#0F172A]">{l.email}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#475569]">{l.source ?? "—"}</span>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#475569] uppercase">{l.locale ?? "—"}</span>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#475569]">{utmSummary(l.utm)}</span>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#0F172A] font-semibold">
                {l.nurture_step}/{sequenceLength}
              </span>
            </td>
            <td className="px-6 py-4">
              <StatusPill status={l.status} colorMap={statusColors} />
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#64748B]">{fmtDate(l.created_at)}</span>
            </td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, Download, Flame } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminStatsRow } from "@/components/admin/AdminStatsRow";
import { AdminFilterBar } from "@/components/admin/AdminFilterBar";
import { AdminTable, type AdminTableHeader } from "@/components/admin/AdminTable";
import { StatusPill } from "@/components/admin/StatusPill";

interface Lead {
  id: string;
  email: string;
  store: string | null;
  verdict: string | null;
  lane: string | null;
  ratio_pct: number | null;
  ratio_band: string | null;
  disputes_per_month: number | null;
  orders_per_month: number | null;
  status: string;
  created_at: string;
}

interface Stats {
  total: number;
  last7d: number;
  winnable: number;
  hot: number;
}

const VERDICT_LABEL: Record<string, string> = {
  win: "Winnable",
  borderline: "Borderline",
  no: "Not winnable",
  other: "Different lane",
};

const verdictColors: Record<string, { bg: string; text: string }> = {
  win: { bg: "bg-[#DCFCE7]", text: "text-[#15803D]" },
  borderline: { bg: "bg-[#FEF3C7]", text: "text-[#B45309]" },
  no: { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]" },
  other: { bg: "bg-[#DBEAFE]", text: "text-[#1D4ED8]" },
};

const bandColors: Record<string, string> = {
  green: "text-[#15803D]",
  amber: "text-[#B45309]",
  red: "text-[#991B1B]",
  unknown: "text-[#64748B]",
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

function fmtRatio(l: Lead): string {
  if (l.ratio_pct == null) return "—";
  return `${l.ratio_pct.toFixed(2)}%`;
}

function fmtVolume(l: Lead): string {
  const d = l.disputes_per_month ?? "—";
  const o = l.orders_per_month ?? "—";
  return `${d} / ${o}`;
}

function isHot(l: Lead): boolean {
  return l.verdict === "win" && l.ratio_band === "red";
}

function toCsv(leads: Lead[]): string {
  const header = "email,store,verdict,ratio_pct,ratio_band,disputes,orders,status,created_at";
  const rows = leads.map((l) => {
    const cells = [
      l.email,
      l.store ?? "",
      l.verdict ?? "",
      l.ratio_pct ?? "",
      l.ratio_band ?? "",
      l.disputes_per_month ?? "",
      l.orders_per_month ?? "",
      l.status,
      l.created_at,
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
    return cells.join(",");
  });
  return [header, ...rows].join("\n");
}

export default function AdminWinnabilityLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (verdictFilter !== "all") params.set("verdict", verdictFilter);
      const res = await fetch(`/api/admin/winnability-leads?${params.toString()}`);
      if (!res.ok) {
        setLeads([]);
        return;
      }
      const data = await res.json();
      setLeads(data.leads ?? []);
      setStats(data.stats ?? null);
    } finally {
      setLoading(false);
    }
  }, [search, verdictFilter]);

  useEffect(() => {
    const id = setTimeout(fetchLeads, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [fetchLeads, search]);

  const downloadCsv = () => {
    const blob = new Blob([toCsv(leads)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `winnability-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8">
      <AdminPageHeader
        title="Winnability Leads"
        subtitle="Inbound campaign — 5-Minute Winnability Test (/test) completions"
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
          { label: "New (7 days)", value: stats?.last7d ?? 0, valueColor: "text-[#2563EB]" },
          { label: "Winnable", value: stats?.winnable ?? 0, valueColor: "text-[#22C55E]" },
          { label: "Hot (win + red)", value: stats?.hot ?? 0, valueColor: "text-[#DC2626]" },
        ]}
      />

      <AdminFilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by email..."
        filters={[
          { label: "All", value: "all" },
          { label: "Winnable", value: "win" },
          { label: "Borderline", value: "borderline" },
          { label: "Not winnable", value: "no" },
          { label: "Different lane", value: "other" },
        ]}
        activeFilter={verdictFilter}
        onFilterChange={setVerdictFilter}
      />

      <AdminTable
        headers={
          ["Email", "Store", "Verdict", "Ratio", "Volume (d/o)", "Captured"] as AdminTableHeader[]
        }
        loading={loading}
        isEmpty={!loading && leads.length === 0}
        emptyIcon={<Mail className="w-8 h-8 text-[#CBD5E1]" />}
        emptyTitle="No leads yet"
        emptyMessage="Completions from /test will appear here"
      >
        {leads.map((l) => (
          <tr key={l.id} className="hover:bg-[#F8FAFC] transition-colors">
            <td className="px-6 py-4">
              <div className="flex items-center gap-2">
                {isHot(l) ? (
                  <Flame className="w-4 h-4 text-[#DC2626]" />
                ) : (
                  <Mail className="w-4 h-4 text-[#64748B]" />
                )}
                <span className="text-sm font-medium text-[#0F172A]">{l.email}</span>
              </div>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#475569]">{l.store ?? "—"}</span>
            </td>
            <td className="px-6 py-4">
              {l.verdict ? (
                <StatusPill
                  status={l.verdict}
                  label={VERDICT_LABEL[l.verdict] ?? l.verdict}
                  colorMap={verdictColors}
                />
              ) : (
                <span className="text-sm text-[#94A3B8]">—</span>
              )}
            </td>
            <td className="px-6 py-4">
              <span className={`text-sm font-semibold ${bandColors[l.ratio_band ?? "unknown"]}`}>
                {fmtRatio(l)}
              </span>
            </td>
            <td className="px-6 py-4">
              <span className="text-sm text-[#475569]">{fmtVolume(l)}</span>
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

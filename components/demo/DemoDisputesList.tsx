"use client";

import Link from "next/link";
import { ChevronRight, Search, Filter, Download } from "lucide-react";
import { DEMO_DISPUTES } from "@/lib/demo/fixtures/disputes";

const STRENGTH_STYLES = {
  strong: { bg: "bg-[#DCFCE7]", text: "text-[#166534]", label: "Strong" },
  moderate: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]", label: "Moderate" },
  weak: { bg: "bg-[#FEE2E2]", text: "text-[#991B1B]", label: "Weak" },
  covered: { bg: "bg-[#EDE9FE]", text: "text-[#5B21B6]", label: "Covered" },
  fatal_loss: { bg: "bg-[#FEF3C7]", text: "text-[#92400E]", label: "Blocked" },
} as const;

export function DemoDisputesList() {
  const totalAtRisk = DEMO_DISPUTES.filter((d) => d.status !== "covered").reduce((s, d) => s + d.amount, 0);
  const strongCount = DEMO_DISPUTES.filter((d) => d.strength === "strong").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0B1220]">Disputes</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">Auto-synced from Shopify Payments. Strong cases are ready to submit; weak ones are parked for review.</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs text-[#6B7280] font-medium">Open</div>
          <div className="text-xl font-semibold text-[#0B1220] mt-1">{DEMO_DISPUTES.length}</div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs text-[#6B7280] font-medium">At risk</div>
          <div className="text-xl font-semibold text-[#0B1220] mt-1">${totalAtRisk.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs text-[#6B7280] font-medium">Strong cases</div>
          <div className="text-xl font-semibold text-[#0B1220] mt-1">{strongCount}</div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
          <div className="text-xs text-[#6B7280] font-medium">Win rate (30d)</div>
          <div className="text-xl font-semibold text-[#0B1220] mt-1">87%</div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 flex items-center gap-2">
        <select
          className="h-9 text-sm rounded-md border border-[#E5E7EB] px-2.5 bg-white text-[#0B1220] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]"
          defaultValue="all"
        >
          <option value="all">All status</option>
          <option>Action needed</option>
          <option>Needs review</option>
          <option>Under review</option>
          <option>Submitted</option>
          <option>Closed</option>
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Search disputes…"
            readOnly
            className="w-full h-9 pl-9 pr-3 text-sm rounded-md border border-[#E5E7EB] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] placeholder:text-[#9CA3AF]"
          />
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-md border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F9FAFB] transition-colors">
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-md border border-[#E5E7EB] text-[#0B1220] hover:bg-[#F9FAFB] transition-colors">
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-xs uppercase tracking-wider text-[#6B7280]">
                <th className="text-left font-medium px-5 py-3">Order</th>
                <th className="text-left font-medium px-3 py-3">Customer</th>
                <th className="text-left font-medium px-3 py-3">Reason</th>
                <th className="text-right font-medium px-3 py-3">Amount</th>
                <th className="text-left font-medium px-3 py-3">Strength</th>
                <th className="text-left font-medium px-3 py-3">Status</th>
                <th className="text-left font-medium px-3 py-3">Due</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F2F4]">
              {DEMO_DISPUTES.map((d) => {
                const s = STRENGTH_STYLES[d.strength];
                const due = Math.round((new Date(d.dueAt).getTime() - new Date("2026-01-15T10:00:00Z").getTime()) / 86_400_000);
                const isUrgent = due <= 4 && d.status !== "covered";
                return (
                  <tr key={d.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/demo/disputes/${d.id}`} className="text-[#1D4ED8] hover:underline font-medium">
                        {d.orderName}
                      </Link>
                      <div className="text-xs text-[#9CA3AF]">{d.id.toUpperCase()}</div>
                    </td>
                    <td className="px-3 py-3 text-[#0B1220]">{d.customerName}</td>
                    <td className="px-3 py-3 text-[#0B1220]">{d.reasonLabel}</td>
                    <td className="px-3 py-3 text-[#0B1220] text-right font-medium">${d.amount.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${s.bg} ${s.text}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[#4B5563]">{d.statusLabel}</td>
                    <td className="px-3 py-3">
                      <span className={isUrgent ? "text-[#DC2626] font-medium" : "text-[#4B5563]"}>
                        {due > 0 ? `In ${due}d` : "Due today"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/demo/disputes/${d.id}`} className="text-[#9CA3AF] hover:text-[#0B1220]">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

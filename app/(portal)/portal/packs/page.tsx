"use client";

import { useTranslations, useLocale } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PACKS = [
  { id: "P-10342", disputeId: "D-10342", orderId: "#10492", reason: "productNotReceived", created: "2026-02-19", status: "Draft", completeness: 0 },
  { id: "P-10343", disputeId: "D-10343", orderId: "#10488", reason: "fraudulent", created: "2026-02-18", status: "Draft", completeness: 42 },
  { id: "P-10344", disputeId: "D-10344", orderId: "#10463", reason: "productUnacceptable", created: "2026-02-15", status: "Ready", completeness: 86 },
  { id: "P-10345", disputeId: "D-10345", orderId: "#10501", reason: "productNotReceived", created: "2026-02-20", status: "Draft", completeness: 58 },
  { id: "P-10346", disputeId: "D-10346", orderId: "#10475", reason: "fraudulent", created: "2026-02-17", status: "Ready", completeness: 95 },
  { id: "P-10348", disputeId: "D-10348", orderId: "#10498", reason: "duplicate", created: "2026-02-19", status: "Draft", completeness: 68 },
  { id: "P-10349", disputeId: "D-10349", orderId: "#10510", reason: "productNotReceived", created: "2026-02-16", status: "Ready", completeness: 78 },
];

export default function PacksPage() {
  const t = useTranslations("packs");
  const tt = useTranslations("table");
  const ts = useTranslations("status");
  const tr = useTranslations("reasons");
  const locale = useLocale();
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredPacks = PACKS.filter(
    (p) => statusFilter === "all" || p.status === statusFilter
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220] mb-2">{t("title")}</h1>
        <p className="text-sm text-[#667085]">
          {t("subtitle")}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E7EB] p-4 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
        >
          <option value="all">{t("allStatuses")}</option>
          <option value="Draft">{ts("draft")}</option>
          <option value="Ready">{ts("ready")}</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden" data-onboarding="packs-grid">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F8FA]">
              <tr className="border-b border-[#E5E7EB]">
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{tt("id")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{t("dispute")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{tt("order")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{tt("reason")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{tt("created")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{tt("status")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{t("completeness")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{t("pdf")}</th>
                <th className="text-left text-xs font-medium text-[#667085] px-6 py-3">{tt("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPacks.map((pack) => (
                <tr
                  key={pack.id}
                  className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F7F8FA] transition-colors"
                >
                  <td className="px-6 py-4 font-medium text-[#0B1220]">{pack.id}</td>
                  <td className="px-6 py-4">
                    <a href={`/portal/disputes/${pack.disputeId}`} className="text-[#4F46E5] hover:text-[#4338CA] hover:underline">{pack.disputeId}</a>
                  </td>
                  <td className="px-6 py-4 text-[#667085]">{pack.orderId}</td>
                  <td className="px-6 py-4 text-[#667085]">{tr.has(pack.reason) ? tr(pack.reason) : pack.reason}</td>
                  <td className="px-6 py-4 text-[#667085]">{new Date(pack.created).toLocaleDateString(locale)}</td>
                  <td className="px-6 py-4">
                    <Badge variant={pack.status === "Ready" ? "success" : "warning"}>
                      {pack.status === "Ready" ? ts("ready") : ts("draft")}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-[#E5E7EB] rounded-full h-2 max-w-[60px]">
                        <div
                          className="bg-[#10B981] h-2 rounded-full"
                          style={{ width: `${pack.completeness}%` }}
                        />
                      </div>
                      <span className="text-xs text-[#667085]">{pack.completeness}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {pack.status === "Ready" ? (
                      <button className="text-sm text-[#4F46E5] hover:text-[#4338CA]">{t("download")}</button>
                    ) : (
                      <span className="text-sm text-[#667085]">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <a href={`/portal/disputes/${pack.disputeId}`}>
                      <Button variant="ghost" size="sm">{t("view")}</Button>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  AlertTriangle,
  TrendingUp,
  Package,
  DollarSign,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { KPICard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";
import { WelcomeBanner } from "@/components/onboarding/welcome-banner";

const recentDisputes = [
  { id: "DP-2401", customer: "John Smith", date: "2024-02-20", amount: "$145.00", status: "needs_evidence" },
  { id: "DP-2402", customer: "Sarah Johnson", date: "2024-02-21", amount: "$89.50", status: "under_review" },
  { id: "DP-2403", customer: "Mike Davis", date: "2024-02-22", amount: "$234.00", status: "needs_evidence" },
  { id: "DP-2404", customer: "Emma Wilson", date: "2024-02-23", amount: "$167.25", status: "won" },
];

const statusMap: Record<string, { variant: "success" | "warning" | "info" | "danger"; label: string }> = {
  needs_evidence: { variant: "warning", label: "Needs Evidence" },
  under_review: { variant: "info", label: "Under Review" },
  won: { variant: "success", label: "Won" },
  lost: { variant: "danger", label: "Lost" },
};

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220] mb-2">{t("overview")}</h1>
        <p className="text-[#667085]">
          {t("subtitle")}
        </p>
      </div>

      <WelcomeBanner />

      <div className="mb-6">
        <InfoBanner variant="info" title="Evidence Generated in DisputeDesk">
          Evidence packs are created and managed here. To submit evidence to
          the card network, you must{" "}
          <a href="#" className="font-semibold hover:underline inline-flex items-center gap-1">
            open Shopify Admin
            <ExternalLink className="w-3 h-3" />
          </a>
          .
        </InfoBanner>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" data-onboarding="dashboard-stats">
        <KPICard
          label={t("activeDisputes")}
          value="23"
          change={-12}
          changeLabel={t("vsLastMonth")}
          icon={<AlertTriangle className="w-6 h-6" />}
        />
        <KPICard
          label={t("winRate")}
          value="68%"
          change={5}
          changeLabel={t("vsLastMonth")}
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <KPICard
          label={t("evidencePacks")}
          value="47"
          change={8}
          changeLabel={t("vsLastMonth")}
          icon={<Package className="w-6 h-6" />}
        />
        <KPICard
          label={t("amountAtRisk")}
          value="$3,421"
          change={-15}
          changeLabel={t("vsLastMonth")}
          icon={<DollarSign className="w-6 h-6" />}
        />
      </div>

      {/* Recent Disputes */}
      <div className="bg-white rounded-lg border border-[#E5E7EB]">
        <div className="flex items-center justify-between p-4 border-b border-[#E5E7EB]">
          <div>
            <h2 className="font-semibold text-[#0B1220]">{t("recentDisputes")}</h2>
            <p className="text-sm text-[#667085] mt-1">{t("recentDisputesDesc")}</p>
          </div>
          <a href="/portal/disputes">
            <Button variant="ghost" size="sm">
              {tc("viewAll")}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F8FA] border-b border-[#E5E7EB]">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">Dispute ID</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">Customer</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">Date</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">Amount</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {recentDisputes.map((d) => {
                const cfg = statusMap[d.status] ?? statusMap.needs_evidence;
                return (
                  <tr key={d.id} className="hover:bg-[#F7F8FA] transition-colors">
                    <td className="px-6 py-4 font-medium text-[#0B1220]">{d.id}</td>
                    <td className="px-6 py-4 text-[#0B1220]">{d.customer}</td>
                    <td className="px-6 py-4 text-[#667085]">{d.date}</td>
                    <td className="px-6 py-4 font-medium text-[#0B1220]">{d.amount}</td>
                    <td className="px-6 py-4">
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm">View Details</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#EFF6FF] rounded-lg flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-[#4F46E5]" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-[#0B1220] mb-1">{t("manageDisputes")}</h4>
              <p className="text-sm text-[#667085] mb-3">{t("manageDisputesDesc")}</p>
              <a href="/portal/disputes">
                <Button variant="ghost" size="sm">
                  {t("goToDisputes")}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#ECFDF5] rounded-lg flex items-center justify-center flex-shrink-0">
              <Package className="w-6 h-6 text-[#10B981]" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-[#0B1220] mb-1">{t("evidenceLibrary")}</h4>
              <p className="text-sm text-[#667085] mb-3">{t("evidenceLibraryDesc")}</p>
              <a href="/portal/packs">
                <Button variant="ghost" size="sm">
                  {t("viewPacks")}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </a>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#FEF3C7] rounded-lg flex items-center justify-center flex-shrink-0">
              <ExternalLink className="w-6 h-6 text-[#F59E0B]" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-[#0B1220] mb-1">{t("shopifyAdmin")}</h4>
              <p className="text-sm text-[#667085] mb-3">{t("shopifyAdminDesc")}</p>
              <Button variant="ghost" size="sm">
                {t("openShopify")}
                <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

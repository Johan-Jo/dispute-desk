"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  TrendingUp,
  Package,
  DollarSign,
  ArrowRight,
  ExternalLink,
  Inbox,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { KPICard } from "@/components/ui/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoBanner } from "@/components/ui/info-banner";
import { WelcomeBanner } from "@/components/onboarding/welcome-banner";
import { PortalSetupChecklistCard } from "@/components/setup/PortalSetupChecklistCard";
import { useDemoMode } from "@/lib/demo-mode";
import { useActiveShopId } from "@/lib/portal/activeShopContext";

interface DisputeRow {
  id: string;
  dispute_gid: string;
  customer_display_name: string | null;
  order_name: string | null;
  due_at: string | null;
  amount: number | null;
  currency_code: string | null;
  status: string | null;
}

const DEMO_DISPUTES = [
  { id: "DP-2401", customer: "John Smith", date: "2024-02-20", amount: "$145.00", status: "needs_evidence" },
  { id: "DP-2402", customer: "Sarah Johnson", date: "2024-02-21", amount: "$89.50", status: "under_review" },
  { id: "DP-2403", customer: "Mike Davis", date: "2024-02-22", amount: "$234.00", status: "needs_evidence" },
  { id: "DP-2404", customer: "Emma Wilson", date: "2024-02-23", amount: "$167.25", status: "won" },
];

const ACTIVE_STATUSES = ["needs_response", "under_review", "building", "blocked", "ready", "saved_to_shopify"];

const STATUS_VARIANTS: Record<string, "success" | "warning" | "info" | "danger"> = {
  needs_evidence: "warning",
  needs_response: "warning",
  under_review: "info",
  building: "info",
  blocked: "danger",
  ready: "info",
  saved_to_shopify: "success",
  won: "success",
  lost: "danger",
};

const STATUS_KEYS: Record<string, string> = {
  needs_evidence: "needsReview",
  needs_response: "needsResponse",
  under_review: "underReview",
  building: "building",
  blocked: "blocked",
  ready: "readyToSave",
  saved_to_shopify: "savedToShopify",
  won: "won",
  lost: "lost",
};

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const tt = useTranslations("table");
  const ts = useTranslations("status");
  const locale = useLocale();
  const isDemo = useDemoMode();
  const shopId = useActiveShopId() ?? "";

  const [recentDisputes, setRecentDisputes] = useState<DisputeRow[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [amountAtRisk, setAmountAtRisk] = useState(0);
  const [winRate, setWinRate] = useState<number | null>(null);
  const [packCount, setPackCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    if (isDemo || !shopId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [disputesRes, packsRes] = await Promise.all([
        fetch(`/api/disputes?shop_id=${encodeURIComponent(shopId)}&per_page=100`),
        fetch(`/api/packs?shopId=${encodeURIComponent(shopId)}`),
      ]);
      const disputesData = await disputesRes.json();
      const packsData = packsRes.ok ? await packsRes.json() : { packs: [] };

      const disputes: DisputeRow[] = disputesData.disputes ?? [];
      const active = disputes.filter((d) => d.status && ACTIVE_STATUSES.includes(d.status));
      const totalActiveAmount = active.reduce((sum, d) => sum + (d.amount ?? 0), 0);
      const won = disputes.filter((d) => d.status === "won").length;
      const lost = disputes.filter((d) => d.status === "lost").length;
      const resolved = won + lost;

      setRecentDisputes(disputes.slice(0, 5));
      setActiveCount(active.length);
      setAmountAtRisk(totalActiveAmount);
      setWinRate(resolved > 0 ? Math.round((won / resolved) * 100) : null);
      setPackCount(Array.isArray(packsData.packs) ? packsData.packs.length : 0);
    } catch {
      setRecentDisputes([]);
      setActiveCount(0);
      setAmountAtRisk(0);
      setWinRate(null);
      setPackCount(0);
    } finally {
      setLoading(false);
    }
  }, [shopId, isDemo]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const recentForDisplay = isDemo ? DEMO_DISPUTES : recentDisputes;
  const showRecentTable = isDemo ? recentForDisplay.length > 0 : recentDisputes.length > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0B1220] mb-2">{t("overview")}</h1>
        <p className="text-[#667085]">
          {t("subtitle")}
        </p>
      </div>

      <WelcomeBanner />

      <PortalSetupChecklistCard />

      <div className="mb-6">
        <InfoBanner variant="info" title={t("infoBannerTitle")}>
          {t("infoBannerDesc")}{" "}
          <a href="/portal/connect-shopify" className="font-semibold hover:underline inline-flex items-center gap-1">
            {t("openShopify")}
            <ExternalLink className="w-3 h-3" />
          </a>
          .
        </InfoBanner>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" data-onboarding="dashboard-stats">
        <KPICard
          label={t("activeDisputes")}
          value={isDemo ? "23" : loading ? "…" : String(activeCount)}
          change={isDemo ? -12 : undefined}
          changeLabel={isDemo ? t("vsLastMonth") : undefined}
          icon={<AlertTriangle className="w-6 h-6" />}
        />
        <KPICard
          label={t("winRate")}
          value={isDemo ? "68%" : loading ? "…" : winRate !== null ? `${winRate}%` : "—"}
          change={isDemo ? 5 : undefined}
          changeLabel={isDemo ? t("vsLastMonth") : undefined}
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <KPICard
          label={t("evidencePacks")}
          value={isDemo ? "47" : loading ? "…" : String(packCount)}
          change={isDemo ? 8 : undefined}
          changeLabel={isDemo ? t("vsLastMonth") : undefined}
          icon={<Package className="w-6 h-6" />}
        />
        <KPICard
          label={t("amountAtRisk")}
          value={
            isDemo
              ? "$3,421"
              : loading
                ? "…"
                : new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amountAtRisk)
          }
          change={isDemo ? -15 : undefined}
          changeLabel={isDemo ? t("vsLastMonth") : undefined}
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

        {showRecentTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#F7F8FA] border-b border-[#E5E7EB]">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">{tt("id")}</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">{tt("customer")}</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">{tt("date")}</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">{tt("amount")}</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">{tt("status")}</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-[#667085] uppercase tracking-wider">{tt("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {isDemo
                  ? (recentForDisplay as typeof DEMO_DISPUTES).map((d) => {
                      const variant = STATUS_VARIANTS[d.status] ?? "warning";
                      const statusKey = STATUS_KEYS[d.status] ?? "unknown";
                      return (
                        <tr key={d.id} className="hover:bg-[#F7F8FA] transition-colors">
                          <td className="px-6 py-4 font-medium text-[#0B1220]">{d.id}</td>
                          <td className="px-6 py-4 text-[#0B1220]">{d.customer}</td>
                          <td className="px-6 py-4 text-[#667085]">{new Date(d.date).toLocaleDateString(locale)}</td>
                          <td className="px-6 py-4 font-medium text-[#0B1220]">{d.amount}</td>
                          <td className="px-6 py-4">
                            <Badge variant={variant}>{ts(statusKey)}</Badge>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <a href={`/portal/disputes/${d.id}`}>
                              <Button variant="ghost" size="sm">{t("viewDetails")}</Button>
                            </a>
                          </td>
                        </tr>
                      );
                    })
                  : recentDisputes.map((d) => {
                      const variant = STATUS_VARIANTS[d.status ?? ""] ?? "warning";
                      const statusKey = STATUS_KEYS[d.status ?? ""] ?? "unknown";
                      const shortId = d.dispute_gid.split("/").pop() ?? d.id;
                      const customer = d.customer_display_name ?? d.order_name ?? "—";
                      const amountStr = d.amount != null
                        ? new Intl.NumberFormat(locale, { style: "currency", currency: d.currency_code ?? "USD" }).format(d.amount)
                        : "—";
                      const dateStr = d.due_at ? new Date(d.due_at).toLocaleDateString(locale) : "—";
                      return (
                        <tr key={d.id} className="hover:bg-[#F7F8FA] transition-colors">
                          <td className="px-6 py-4 font-medium text-[#0B1220]">{shortId}</td>
                          <td className="px-6 py-4 text-[#0B1220]">{customer}</td>
                          <td className="px-6 py-4 text-[#667085]">{dateStr}</td>
                          <td className="px-6 py-4 font-medium text-[#0B1220]">{amountStr}</td>
                          <td className="px-6 py-4">
                            <Badge variant={variant}>{ts(statusKey)}</Badge>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <a href={`/portal/disputes/${d.id}`}>
                              <Button variant="ghost" size="sm">{t("viewDetails")}</Button>
                            </a>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center">
            {!isDemo && loading ? (
              <p className="text-sm text-[#667085]">{tc("loading")}</p>
            ) : (
              <>
                <Inbox className="w-10 h-10 text-[#D1D5DB] mx-auto mb-3" />
                <p className="text-sm font-medium text-[#0B1220] mb-1">{t("noDisputesYet")}</p>
                <p className="text-xs text-[#667085]">{t("noDisputesYetDesc")}</p>
              </>
            )}
          </div>
        )}
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
              <a href="/portal/connect-shopify">
                <Button variant="ghost" size="sm">
                  {t("openShopify")}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard — Figma Make: shopify-home.tsx
 * Complete redesign. No SetupChecklistCard, ConfigGuideCard, or old setup UI.
 */
"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { useSearchParams } from "next/navigation";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ChevronRight,
  DollarSign,
  BarChart3,
} from "lucide-react";
import type { SetupStateResponse } from "@/lib/setup/types";

type PeriodKey = "24h" | "7d" | "30d" | "all";

interface DashboardStats {
  totalDisputes: number;
  winRate: number;
  revenueRecovered: string;
  avgResponseTime: string;
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
}

const DEFAULT_STATS: DashboardStats = {
  totalDisputes: 0,
  winRate: 0,
  revenueRecovered: "$0",
  avgResponseTime: "—",
  winRateTrend: [0, 0, 0, 0, 0, 0],
  disputeCategories: [],
};

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

function SetupBanner() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setState(data ?? null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading || !state || state.allDone) return null;

  const continueUrl = state.nextStepId
    ? withShopParams(`/app/setup/${state.nextStepId}`, searchParams)
    : "/app/setup/overview";

  return (
    <div className="mb-6 rounded-lg border border-[#FFCC80] bg-[#FFF4E5] p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#B95000]" />
        <div className="flex-1">
          <h3 className="mb-1 text-sm font-semibold text-[#202223]">
            {t("dashboard.completeSetup")}
          </h3>
          <p className="mb-3 text-sm text-[#6D7175]">
            {t("dashboard.completeSetupDesc")}
          </p>
          <Link
            href={continueUrl}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#1D4ED8] hover:text-[#1e40af]"
          >
            {t("dashboard.continueSetup")}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function OverviewStats({ period, onPeriodChange }: { period: PeriodKey; onPeriodChange: (p: PeriodKey) => void }) {
  const t = useTranslations();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const shopId = document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1];
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetch(`/api/dashboard/stats?shop_id=${shopId}&period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const s = stats ?? DEFAULT_STATS;

  return (
    <div className="mb-8 rounded-lg border border-[#E1E3E5] bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-[#202223]">{t("dashboard.overview")}</h2>
        <div className="inline-flex rounded-lg bg-[#F1F2F4] p-1">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onPeriodChange(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
                period === key ? "bg-white text-[#202223] shadow-sm" : "text-[#6D7175] hover:text-[#202223]"
              }`}
            >
              {t(`dashboard.period${key === "all" ? "All" : key}`)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-[#6D7175]">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-[#E1E3E5] bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#E0F2FE]">
                <FileText className="h-4 w-4 text-[#1D4ED8]" />
              </div>
              <h3 className="text-sm font-medium text-[#6D7175]">{t("dashboard.totalDisputes")}</h3>
            </div>
            <span className="text-3xl font-semibold text-[#202223]">{s.totalDisputes}</span>
            <p className="mt-1 text-xs text-[#6D7175]">vs. last period</p>
          </div>

          <div className="rounded-lg border border-[#E1E3E5] bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#D1FAE5]">
                <TrendingUp className="h-4 w-4 text-[#059669]" />
              </div>
              <h3 className="text-sm font-medium text-[#6D7175]">{t("dashboard.winRate")}</h3>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-[#202223]">{s.winRate}%</span>
            </div>
            <p className="mt-1 text-xs text-[#6D7175]">vs. last period</p>
          </div>

          <div className="rounded-lg border border-[#E1E3E5] bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#DCFCE7]">
                <DollarSign className="h-4 w-4 text-[#059669]" />
              </div>
              <h3 className="text-sm font-medium text-[#6D7175]">{t("dashboard.revenueRecovered")}</h3>
            </div>
            <span className="text-3xl font-semibold text-[#202223]">{s.revenueRecovered}</span>
            <p className="mt-1 text-xs text-[#6D7175]">vs. last period</p>
          </div>

          <div className="rounded-lg border border-[#E1E3E5] bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#FEF3C7]">
                <BarChart3 className="h-4 w-4 text-[#D97706]" />
              </div>
              <h3 className="text-sm font-medium text-[#6D7175]">{t("dashboard.avgResponseTime")}</h3>
            </div>
            <span className="text-3xl font-semibold text-[#202223]">{s.avgResponseTime}</span>
            <p className="mt-1 text-xs text-[#6D7175]">vs. last period</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RecentDisputes() {
  const t = useTranslations();
  const [rows, setRows] = useState<Array<{ id: string; orderLabel: string; amount: string; reason: string | null; status: string | null; deadline: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const shopId = document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1];
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetch(`/api/disputes?shop_id=${shopId}&per_page=5`)
      .then((res) => (res.ok ? res.json() : { disputes: [] }))
      .then((data: { disputes?: Array<{ id: string; order_gid?: string | null; dispute_gid?: string | null; amount?: number | null; currency_code?: string | null; reason?: string | null; status?: string | null; due_at?: string | null }> }) => {
        if (!cancelled) {
          const list = data.disputes ?? [];
          setRows(
            list.map((d) => ({
              id: d.id,
              orderLabel: d.order_gid ? `#${d.order_gid.split("/").pop() ?? ""}` : d.dispute_gid ? String(d.dispute_gid).slice(-8) : d.id.slice(0, 8),
              amount: d.amount != null ? `$${Number(d.amount).toFixed(2)}` : "—",
              reason: d.reason ?? null,
              status: d.status ?? null,
              deadline: d.due_at ? new Date(d.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
            }))
          );
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const statusStyle = (s: string | null) => {
    if (s === "won") return "bg-[#D1FAE5] text-[#065F46]";
    if (s === "lost") return "bg-[#FEE2E2] text-[#991B1B]";
    return "bg-[#FFF4E5] text-[#92400E]";
  };

  const statusLabel = (s: string | null) => s === "won" ? "Won" : s === "lost" ? "Lost" : s ?? "—";

  return (
    <div className="mb-8 rounded-lg border border-[#E1E3E5] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#E1E3E5] px-5 py-4">
        <h2 className="text-base font-semibold text-[#202223]">{t("dashboard.recentDisputes")}</h2>
        <Link href="/app/disputes" className="text-sm font-medium text-[#1D4ED8] hover:text-[#1e40af]">
          {t("common.viewAll")}
        </Link>
      </div>
      {loading ? (
        <div className="flex h-24 items-center justify-center text-[#6D7175]">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[#6D7175]">
          {t("dashboard.noDisputesYetDesc")}
          <Link href="/app/disputes" className="ml-2 font-medium text-[#1D4ED8]">{t("dashboard.goToDisputes")}</Link>
        </div>
      ) : (
        <div className="divide-y divide-[#E1E3E5]">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/app/disputes/${r.id}`}
              className="block px-5 py-4 text-left transition-colors hover:bg-[#F7F8FA]"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-3">
                    <span className="text-sm font-semibold text-[#202223]">{r.orderLabel}</span>
                    <span className="text-sm text-[#6D7175]">{r.reason ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#6D7175]">{r.amount}</span>
                    <span className="text-xs text-[#8C9196]">•</span>
                    <span className="text-sm text-[#6D7175]">{r.deadline ?? "—"}</span>
                  </div>
                </div>
                <span className={`rounded-md px-3 py-1 text-xs font-medium ${statusStyle(r.status)}`}>
                  {statusLabel(r.status)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardCharts({ period }: { period: PeriodKey }) {
  const t = useTranslations();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const shopId = document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1];
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetch(`/api/dashboard/stats?shop_id=${shopId}&period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const s = stats ?? DEFAULT_STATS;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-lg border border-[#E1E3E5] bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-[#202223]">{t("dashboard.winRateTrend")}</h3>
        {loading ? (
          <div className="flex h-64 items-center justify-center text-[#6D7175]">Loading...</div>
        ) : (
          <div className="flex h-64 items-end justify-between gap-2">
            {s.winRateTrend.map((value, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-2">
                <div className="relative w-full rounded-t-lg bg-[#E0F2FE]" style={{ height: `${Math.max(4, value)}%` }}>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-medium text-[#202223]">
                    {value}%
                  </div>
                </div>
                <span className="text-xs text-[#6D7175]">{months[index] ?? `W${index + 1}`}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#E1E3E5] bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-[#202223]">{t("dashboard.disputeCategories")}</h3>
        {loading ? (
          <div className="flex h-48 items-center justify-center text-[#6D7175]">Loading...</div>
        ) : s.disputeCategories.length === 0 ? (
          <p className="text-sm text-[#6D7175]">{t("dashboard.noDisputesYetDesc")}</p>
        ) : (
          <div className="space-y-4">
            {s.disputeCategories.map(({ label, value }) => (
              <div key={label}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm text-[#202223]">{label}</span>
                  <span className="text-sm font-medium text-[#202223]">{value}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#F1F2F4]">
                  <div
                    className="h-full rounded-full bg-[#1D4ED8] transition-all"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const [period, setPeriod] = useState<PeriodKey>("30d");

  return (
    <div className="min-h-screen bg-[#F1F2F4] p-6">
      <div className="mx-auto max-w-6xl">
        <Suspense fallback={null}>
          <SetupBanner />
        </Suspense>

        <OverviewStats period={period} onPeriodChange={setPeriod} />
        <RecentDisputes />
        <DashboardCharts period={period} />
      </div>
    </div>
  );
}

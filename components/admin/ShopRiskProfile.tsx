"use client";

/**
 * Admin "Risk Profile" section on /admin/shops/[id] —
 * Figma `pages/admin/shop-detail.tsx:170-413` (2026-05-01).
 *
 * Layout:
 *   - Sticky header with period selector (30d / 90d / 180d / All time).
 *   - Snapshot row: 6 cards (Chargeback rate · Total disputes ·
 *     Total orders · Amount at risk · Total invoiced · Win rate).
 *   - Charts row (2 cols):
 *     · Dispute breakdown — three labeled progress bars
 *       (Fraud / Item not received / Other).
 *     · Outcomes — three rows with colored 40×40 icon boxes
 *       (Won / Lost / Pending).
 *   - Trend (90d-shaped) — dual-bar chart per bucket
 *     (disputes red + orders gray).
 *   - Additional Signals — three cards
 *     (Inquiry ratio · Last sync · Data completeness).
 *
 * All numbers come from `/api/admin/shops/[id]/risk?period=…`.
 * Period selector triggers a re-fetch (`option 2b`).
 */

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Info,
  Package,
  XCircle,
} from "lucide-react";

interface ChargebackRateResult {
  rate: number | null;
  rateChange: number | null;
  numerator: number;
  denominator: number;
  available: boolean;
  lowVolume: boolean;
  daysCovered: number;
  daysExpected: number;
  lastSyncedAt: string | null;
}

interface PeriodWithChange {
  count: number;
  previous: number | null;
  changePercent: number | null;
}

type RiskPeriod = "30d" | "90d" | "180d" | "all";

interface ShopRiskProfileResponse {
  shopId: string;
  period: RiskPeriod;
  windowDays: number | null;
  rate: ChargebackRateResult;
  totalDisputes: PeriodWithChange;
  totalOrders: PeriodWithChange;
  amountAtRisk: number;
  currencyCode: string;
  reasonBreakdown: { fraud: number; fulfillment: number; other: number };
  outcomeBreakdown: { won: number; lost: number; pending: number };
  winRate: number;
  inquiryCount: number;
  chargebackCount: number;
  trend: Array<{ bucketStart: string; disputeCount: number; orderCount: number }>;
  lastSyncedAt: string | null;
  dataCompleteness: number;
  monthlyRevenue: { planName: string; planId: string; monthlyUsd: number };
  totalInvoiced: { totalUsd: number; windowDays: number; monthsInPeriod: number; isApproximate: true };
}

const PERIOD_LABEL: Record<RiskPeriod, string> = {
  "30d": "30d",
  "90d": "90d",
  "180d": "180d",
  all: "All time",
};

const PERIOD_VERBOSE: Record<RiskPeriod, string> = {
  "30d": "30d",
  "90d": "90d",
  "180d": "180d",
  all: "all time",
};

function thresholdTone(rate: number | null): "healthy" | "watch" | "high" | null {
  if (rate === null) return null;
  if (rate < 0.6) return "healthy";
  if (rate <= 0.9) return "watch";
  return "high";
}

const TONE_BADGE: Record<"healthy" | "watch" | "high", string> = {
  healthy: "bg-[#D1FAE5] text-[#065F46]",
  watch: "bg-[#FEF3C7] text-[#92400E]",
  high: "bg-[#FEE2E2] text-[#991B1B]",
};

const TONE_LABEL: Record<"healthy" | "watch" | "high", string> = {
  healthy: "Healthy",
  watch: "Watch",
  high: "High risk",
};

function formatRate(r: ChargebackRateResult): string {
  if (!r.available || r.rate === null) return "—";
  return `${r.rate.toFixed(2)}%`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatCurrency(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencyCode} ${formatNumber(Math.round(amount))}`;
  }
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "no snapshot yet";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ChangeBadge({ pct, inverse }: { pct: number | null; inverse?: boolean }) {
  if (pct === null) return <span className="text-xs text-[#94A3B8]">—</span>;
  const isPositive = pct > 0;
  const isNegative = pct < 0;
  // For total disputes (inverse=true) increase is bad → red.
  // For total orders (inverse=false) increase is good → green.
  const goodColor = "text-[#22C55E]";
  const badColor = "text-[#DC2626]";
  const color = isPositive
    ? inverse
      ? badColor
      : goodColor
    : isNegative
      ? inverse
        ? goodColor
        : badColor
      : "text-[#64748B]";
  const sign = isPositive ? "+" : "";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {sign}
      {pct}% vs prev
    </span>
  );
}

interface Props {
  shopId: string;
}

export function ShopRiskProfile({ shopId }: Props) {
  const [period, setPeriod] = useState<RiskPeriod>("90d");
  const [data, setData] = useState<ShopRiskProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/admin/shops/${shopId}/risk?period=${period}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: ShopRiskProfileResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, period]);

  if (error) {
    return (
      <div className="bg-white border border-[#FCA5A5] rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#0F172A] mb-2">Risk profile</h3>
        <div className="text-sm text-[#991B1B]">Could not load risk profile: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <h2 className="text-lg font-bold text-[#0F172A]">Risk profile</h2>
        </div>
        <div className="p-6 text-sm text-[#64748B]">Loading…</div>
      </div>
    );
  }

  const periodVerbose = PERIOD_VERBOSE[data.period];
  const band = thresholdTone(data.rate.rate);
  const totalReasons =
    data.reasonBreakdown.fraud +
    data.reasonBreakdown.fulfillment +
    data.reasonBreakdown.other;
  const totalOutcomes =
    data.outcomeBreakdown.won + data.outcomeBreakdown.lost + data.outcomeBreakdown.pending;
  const lossRate =
    data.outcomeBreakdown.won + data.outcomeBreakdown.lost > 0
      ? Math.round(
          (data.outcomeBreakdown.lost /
            (data.outcomeBreakdown.won + data.outcomeBreakdown.lost)) *
            100,
        )
      : 0;
  const inquiryRatio =
    data.chargebackCount > 0 ? data.inquiryCount / data.chargebackCount : null;

  const trendValues = data.trend.map((t) => t.disputeCount);
  const orderValues = data.trend.map((t) => t.orderCount);
  const maxDisputes = Math.max(1, ...trendValues);
  const maxOrders = Math.max(1, ...orderValues);

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden mb-6">
      {/* Header — Risk Profile + period selector */}
      <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-bold text-[#0F172A]">Risk Profile</h2>
        <div className="inline-flex rounded-lg border border-[#E2E8F0] p-1 bg-white">
          {(["30d", "90d", "180d", "all"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`px-3 py-1.5 text-sm font-semibold rounded transition-all ${
                key === "30d" ? "" : "ml-1"
              } ${
                period === key
                  ? "bg-[#1D4ED8] text-white shadow-sm"
                  : "text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC]"
              }`}
            >
              {PERIOD_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {/* Snapshot row — 6 cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-[#64748B]">Chargeback rate</div>
              {band && (
                <span
                  className={`px-1.5 py-0.5 ${TONE_BADGE[band]} text-[10px] font-semibold rounded`}
                >
                  {TONE_LABEL[band]}
                </span>
              )}
            </div>
            <div className="text-xl font-bold text-[#0F172A] mb-1">{formatRate(data.rate)}</div>
            <div className="text-xs text-[#64748B]">
              {data.rate.numerator} / {formatNumber(data.rate.denominator)}
            </div>
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Total disputes</div>
            <div className="text-xl font-bold text-[#0F172A] mb-1">
              {data.totalDisputes.count}
            </div>
            <ChangeBadge pct={data.totalDisputes.changePercent} inverse />
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Total orders</div>
            <div className="text-xl font-bold text-[#0F172A] mb-1">
              {formatNumber(data.totalOrders.count)}
            </div>
            <ChangeBadge pct={data.totalOrders.changePercent} />
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Amount at risk</div>
            <div className="text-xl font-bold text-[#DC2626] mb-1">
              {formatCurrency(data.amountAtRisk, data.currencyCode)}
            </div>
            <div className="text-xs text-[#64748B]">{data.outcomeBreakdown.pending} pending</div>
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Total invoiced</div>
            <div className="text-xl font-bold text-[#0F172A] mb-1">
              ${data.totalInvoiced.totalUsd.toLocaleString()}
            </div>
            <div className="text-xs text-[#64748B]">
              {periodVerbose}
              {/* Approximation hint — see lib/admin/shopBilling.ts */}
              <span className="ml-1 text-[#94A3B8]" title="Approximate: monthly price × months in window. No invoice history yet.">
                ≈
              </span>
            </div>
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Win rate</div>
            <div className="text-xl font-bold text-[#065F46] mb-1">{data.winRate}%</div>
            <div className="text-xs text-[#64748B]">{data.outcomeBreakdown.won} won</div>
          </div>
        </div>

        {/* Charts grid — Dispute breakdown + Outcomes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="border border-[#E2E8F0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-4">
              Dispute breakdown ({periodVerbose})
            </h3>
            <div className="space-y-3">
              <BreakdownRow
                icon={<AlertCircle className="w-4 h-4 text-[#DC2626]" />}
                label="Fraud / Unauthorized"
                count={data.reasonBreakdown.fraud}
                total={totalReasons}
                barClass="bg-[#DC2626]"
              />
              <BreakdownRow
                icon={<Package className="w-4 h-4 text-[#3B82F6]" />}
                label="Item not received"
                count={data.reasonBreakdown.fulfillment}
                total={totalReasons}
                barClass="bg-[#3B82F6]"
              />
              <BreakdownRow
                icon={<AlertCircle className="w-4 h-4 text-[#F59E0B]" />}
                label="Other"
                count={data.reasonBreakdown.other}
                total={totalReasons}
                barClass="bg-[#F59E0B]"
              />
              {totalReasons === 0 && (
                <div className="text-sm text-[#64748B]">No disputes in window.</div>
              )}
            </div>
          </div>

          <div className="border border-[#E2E8F0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-4">
              Outcomes ({periodVerbose})
            </h3>
            <div className="space-y-4">
              <OutcomeRow
                icon={<CheckCircle className="w-5 h-5 text-[#065F46]" />}
                iconBg="bg-[#D1FAE5]"
                title="Won"
                helper={`${data.winRate}% win rate`}
                count={data.outcomeBreakdown.won}
                countColor="text-[#065F46]"
              />
              <OutcomeRow
                icon={<XCircle className="w-5 h-5 text-[#991B1B]" />}
                iconBg="bg-[#FEE2E2]"
                title="Lost"
                helper={`${lossRate}% loss rate`}
                count={data.outcomeBreakdown.lost}
                countColor="text-[#991B1B]"
              />
              <OutcomeRow
                icon={<Clock className="w-5 h-5 text-[#92400E]" />}
                iconBg="bg-[#FEF3C7]"
                title="Pending"
                helper="Awaiting decision"
                count={data.outcomeBreakdown.pending}
                countColor="text-[#92400E]"
              />
              {totalOutcomes === 0 && (
                <div className="text-sm text-[#64748B]">No disputes in window.</div>
              )}
            </div>
          </div>
        </div>

        {/* Trend — dual-bar (disputes + orders) per bucket */}
        <div className="border border-[#E2E8F0] rounded-lg p-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold text-[#0F172A]">
              Dispute trend ({periodVerbose})
            </h3>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[#DC2626] rounded" />
                <span className="text-[#64748B]">Disputes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[#94A3B8] rounded" />
                <span className="text-[#64748B]">Orders (scaled)</span>
              </div>
            </div>
          </div>

          <div className="relative h-48">
            <div className="absolute inset-0 flex items-end justify-between gap-1">
              {data.trend.map((point, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center gap-0.5 h-40">
                    <div
                      className="w-full bg-[#DC2626] rounded-t transition-all hover:opacity-80"
                      style={{
                        height: `${(point.disputeCount / maxDisputes) * 100}%`,
                      }}
                      title={`${point.disputeCount} disputes`}
                    />
                    <div
                      className="w-full bg-[#94A3B8] rounded-t transition-all hover:opacity-80"
                      style={{
                        height: `${(point.orderCount / maxOrders) * 100}%`,
                      }}
                      title={`${point.orderCount} orders`}
                    />
                  </div>
                  <div className="text-[10px] text-[#64748B] text-center whitespace-nowrap transform -rotate-45 origin-top-left mt-2">
                    {point.bucketStart}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Additional Signals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-[#64748B]" />
              <div className="text-xs text-[#64748B]">Inquiry ratio</div>
            </div>
            <div className="text-lg font-bold text-[#0F172A]">
              {inquiryRatio === null ? "—" : `${inquiryRatio.toFixed(1)}:1`}
            </div>
            <div className="text-xs text-[#64748B] mt-1">Inquiries per chargeback</div>
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-[#64748B]" />
              <div className="text-xs text-[#64748B]">Last sync</div>
            </div>
            <div className="text-lg font-bold text-[#0F172A]">
              {formatRelativeTime(data.lastSyncedAt)}
            </div>
            <div
              className={`text-xs mt-1 ${
                data.dataCompleteness >= 90 ? "text-[#22C55E]" : "text-[#64748B]"
              }`}
            >
              {data.dataCompleteness >= 90 ? "Data is current" : "Partial coverage"}
            </div>
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-[#64748B]" />
              <div className="text-xs text-[#64748B]">Data completeness</div>
            </div>
            <div className="text-lg font-bold text-[#0F172A]">{data.dataCompleteness}%</div>
            <div className="w-full bg-[#E2E8F0] rounded-full h-1.5 mt-2">
              <div
                className="bg-[#22C55E] h-1.5 rounded-full"
                style={{ width: `${data.dataCompleteness}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({
  icon,
  label,
  count,
  total,
  barClass,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  barClass: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm text-[#0F172A]">{label}</span>
        </div>
        <span className="text-sm font-semibold text-[#0F172A]">{count}</span>
      </div>
      <div className="w-full bg-[#E2E8F0] rounded-full h-2">
        <div
          className={`${barClass} h-2 rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function OutcomeRow({
  icon,
  iconBg,
  title,
  helper,
  count,
  countColor,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  helper: string;
  count: number;
  countColor: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center`}
        >
          {icon}
        </div>
        <div>
          <div className="text-sm font-medium text-[#0F172A]">{title}</div>
          <div className="text-xs text-[#64748B]">{helper}</div>
        </div>
      </div>
      <div className={`text-xl font-bold ${countColor}`}>{count}</div>
    </div>
  );
}

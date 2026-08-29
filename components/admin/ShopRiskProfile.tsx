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
 *     · Dispute breakdown — six curated progress bars sorted
 *       largest-first (Fraud / Item not received / Refund /
 *       Not as described / Subscription / Other).
 *     · Outcomes — three rows with colored 40×40 icon boxes
 *       (Won / Lost / Pending).
 *   - Disputes by payment method — progress bars joined from
 *     `shopify_orders.payment_method` (Card / PayPal / Klarna /
 *     wallets), with a "not classified" hint counting the coverage
 *     gaps (no method recorded, or order not synced) that are held
 *     out of the split rather than folded into "Other".
 *   - Trend (90d-shaped) — dual-bar chart per bucket
 *     (disputes red + orders gray) with rotated MMM-D axis labels.
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
  CreditCard,
  Info,
  Package,
  RefreshCcw,
  Repeat,
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
  ordersCoverageStart: string | null;
  ordersCoveragePartial: boolean;
  amountAtRisk: number;
  currencyCode: string;
  amountAtRiskPhase: { chargeback: number; inquiry: number };
  storeRevenue30d: number;
  storeRevenueCurrency: string;
  reasonBreakdown: {
    fraud: number;
    fulfillment: number;
    refund: number;
    quality: number;
    subscription: number;
    other: number;
  };
  reasonPhase: Record<
    "fraud" | "fulfillment" | "refund" | "quality" | "subscription" | "other",
    { chargeback: number; inquiry: number }
  >;
  paymentMethodBreakdown: {
    card: number;
    apple_pay: number;
    google_pay: number;
    shop_pay: number;
    klarna: number;
    paypal: number;
    other: number;
    /** Order synced but no payment_method stored. A coverage gap, not
     *  a method — never charted as a slice of the split. */
    unknown: number;
    unmatched: number;
  };
  klarnaSubProductBreakdown: {
    pay_later: number;
    pay_now: number;
    slice_it: number;
    klarna_unspecified: number;
  };
  outcomeBreakdown: { won: number; lost: number; pending: number };
  outcomePhase: Record<
    "won" | "lost" | "pending",
    { chargeback: number; inquiry: number }
  >;
  winRatePhase: Record<
    "chargeback" | "inquiry",
    { won: number; lost: number; rate: number | null }
  >;
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

/** Compact "N cb · M inq" phase suffix used across the panel. */
function phaseSuffix(split: { chargeback: number; inquiry: number }): string {
  return `${split.chargeback} cb · ${split.inquiry} inq`;
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Turn a bucket-start ISO date (YYYY-MM-DD) into a compact "MMM D"
 *  axis label. Falls back to the raw string if it doesn't parse. */
function formatBucketLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS_SHORT[Number(m[2]) - 1] ?? m[2];
  return `${month} ${Number(m[3])}`;
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
  const rb = data.reasonBreakdown;
  const totalReasons =
    rb.fraud + rb.fulfillment + rb.refund + rb.quality + rb.subscription + rb.other;
  // Six curated buckets, rendered largest-first so the dominant
  // dispute driver leads. Icons/colors are stable per bucket.
  const rp = data.reasonPhase;
  const reasonRows = [
    { key: "fraud", label: "Fraud / Unauthorized", count: rb.fraud, phase: rp.fraud, icon: <AlertCircle className="w-4 h-4 text-[#DC2626]" />, barClass: "bg-[#DC2626]" },
    { key: "fulfillment", label: "Item not received", count: rb.fulfillment, phase: rp.fulfillment, icon: <Package className="w-4 h-4 text-[#3B82F6]" />, barClass: "bg-[#3B82F6]" },
    { key: "refund", label: "Refund not processed", count: rb.refund, phase: rp.refund, icon: <RefreshCcw className="w-4 h-4 text-[#8B5CF6]" />, barClass: "bg-[#8B5CF6]" },
    { key: "quality", label: "Item not as described", count: rb.quality, phase: rp.quality, icon: <Package className="w-4 h-4 text-[#0EA5E9]" />, barClass: "bg-[#0EA5E9]" },
    { key: "subscription", label: "Subscription canceled", count: rb.subscription, phase: rp.subscription, icon: <Repeat className="w-4 h-4 text-[#EC4899]" />, barClass: "bg-[#EC4899]" },
    { key: "other", label: "Other", count: rb.other, phase: rp.other, icon: <AlertCircle className="w-4 h-4 text-[#F59E0B]" />, barClass: "bg-[#F59E0B]" },
  ].sort((a, b) => b.count - a.count);

  const pm = data.paymentMethodBreakdown;
  // Only real payment methods form the denominator. `unknown` (order
  // synced, no method stored) and `unmatched` (order not synced) are
  // coverage gaps and are reported beside the split, never inside it.
  const totalPaymentMethods =
    pm.card +
    pm.apple_pay +
    pm.google_pay +
    pm.shop_pay +
    pm.klarna +
    pm.paypal +
    pm.other;
  const uncharted = pm.unknown + pm.unmatched;

  // Klarna sub-product split (only meaningful when there are Klarna
  // disputes). pay_later — Klarna consumer credit — historically drives
  // more chargebacks than pay_now; surfaced here so the risk mix is visible.
  const ksp = data.klarnaSubProductBreakdown;
  const klarnaSubTotal =
    ksp.pay_later + ksp.pay_now + ksp.slice_it + ksp.klarna_unspecified;
  const klarnaSubRows = [
    { key: "pay_later", label: "Pay Later", count: ksp.pay_later, barClass: "bg-[#FFB3C7]" },
    { key: "pay_now", label: "Pay Now", count: ksp.pay_now, barClass: "bg-[#F472B6]" },
    { key: "slice_it", label: "Slice It", count: ksp.slice_it, barClass: "bg-[#DB2777]" },
    { key: "klarna_unspecified", label: "Unspecified", count: ksp.klarna_unspecified, barClass: "bg-[#CBD5E1]" },
  ]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const paymentRows = [
    { key: "card", label: "Card", count: pm.card, barClass: "bg-[#1D4ED8]" },
    { key: "paypal", label: "PayPal", count: pm.paypal, barClass: "bg-[#003087]" },
    { key: "klarna", label: "Klarna", count: pm.klarna, barClass: "bg-[#FFB3C7]" },
    { key: "apple_pay", label: "Apple Pay", count: pm.apple_pay, barClass: "bg-[#0F172A]" },
    { key: "google_pay", label: "Google Pay", count: pm.google_pay, barClass: "bg-[#22C55E]" },
    { key: "shop_pay", label: "Shop Pay", count: pm.shop_pay, barClass: "bg-[#5A31F4]" },
    { key: "other", label: "Other", count: pm.other, barClass: "bg-[#94A3B8]" },
  ]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
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
              {data.chargebackCount} chargeback{data.chargebackCount === 1 ? "" : "s"} /{" "}
              {formatNumber(data.rate.denominator)} orders
            </div>
            {data.inquiryCount > 0 && (
              <div className="text-[11px] text-[#94A3B8] mt-0.5">
                + {data.inquiryCount} inquir{data.inquiryCount === 1 ? "y" : "ies"} (excluded)
              </div>
            )}
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Total disputes</div>
            <div className="text-xl font-bold text-[#0F172A] mb-1">
              {data.totalDisputes.count}
            </div>
            <div className="text-[11px] text-[#94A3B8] mb-1">
              {data.chargebackCount} chargeback{data.chargebackCount === 1 ? "" : "s"} ·{" "}
              {data.inquiryCount} inquir{data.inquiryCount === 1 ? "y" : "ies"}
            </div>
            <ChangeBadge pct={data.totalDisputes.changePercent} inverse />
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Total orders</div>
            <div className="text-xl font-bold text-[#0F172A] mb-1">
              {formatNumber(data.totalOrders.count)}
            </div>
            {data.ordersCoveragePartial && data.ordersCoverageStart ? (
              <div
                className="text-[11px] text-[#94A3B8]"
                title="The daily-metrics rollup doesn't cover the full selected window, so this count is partial."
              >
                since {formatBucketLabel(data.ordersCoverageStart)}
              </div>
            ) : (
              <ChangeBadge pct={data.totalOrders.changePercent} />
            )}
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Amount at risk</div>
            <div className="text-xl font-bold text-[#DC2626] mb-1">
              {formatCurrency(data.amountAtRisk, data.currencyCode)}
            </div>
            <div className="text-[11px] text-[#94A3B8]">
              {formatCurrency(data.amountAtRiskPhase.chargeback, data.currencyCode)} cb ·{" "}
              {formatCurrency(data.amountAtRiskPhase.inquiry, data.currencyCode)} inq
            </div>
            <div className="text-xs text-[#64748B] mt-0.5">
              {data.outcomeBreakdown.pending} pending
            </div>
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Total invoiced</div>
            {data.monthlyRevenue.planId === "free" ? (
              <>
                <div className="text-xl font-bold text-[#0F172A] mb-1">Free plan</div>
                <div className="text-xs text-[#94A3B8]">No subscription revenue</div>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>

          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4">
            <div className="text-xs text-[#64748B] mb-2">Win rate</div>
            <div className="text-xl font-bold text-[#065F46] mb-1">{data.winRate}%</div>
            <div className="text-[11px] text-[#94A3B8]">
              cb{" "}
              {data.winRatePhase.chargeback.rate === null
                ? "—"
                : `${data.winRatePhase.chargeback.rate}%`}{" "}
              · inq{" "}
              {data.winRatePhase.inquiry.rate === null
                ? "—"
                : `${data.winRatePhase.inquiry.rate}%`}
            </div>
            <div className="text-xs text-[#64748B] mt-0.5">{data.outcomeBreakdown.won} won</div>
          </div>
        </div>

        {/* Charts grid — Dispute breakdown + Outcomes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="border border-[#E2E8F0] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-4">
              Dispute breakdown ({periodVerbose})
            </h3>
            <div className="space-y-3">
              {reasonRows.map((row) => (
                <BreakdownRow
                  key={row.key}
                  icon={row.icon}
                  label={row.label}
                  count={row.count}
                  total={totalReasons}
                  barClass={row.barClass}
                  suffix={row.count > 0 ? phaseSuffix(row.phase) : undefined}
                />
              ))}
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
                suffix={data.outcomeBreakdown.won > 0 ? phaseSuffix(data.outcomePhase.won) : undefined}
              />
              <OutcomeRow
                icon={<XCircle className="w-5 h-5 text-[#991B1B]" />}
                iconBg="bg-[#FEE2E2]"
                title="Lost"
                helper={`${lossRate}% loss rate`}
                count={data.outcomeBreakdown.lost}
                countColor="text-[#991B1B]"
                suffix={data.outcomeBreakdown.lost > 0 ? phaseSuffix(data.outcomePhase.lost) : undefined}
              />
              <OutcomeRow
                icon={<Clock className="w-5 h-5 text-[#92400E]" />}
                iconBg="bg-[#FEF3C7]"
                title="Pending"
                helper="Awaiting decision"
                count={data.outcomeBreakdown.pending}
                countColor="text-[#92400E]"
                suffix={data.outcomeBreakdown.pending > 0 ? phaseSuffix(data.outcomePhase.pending) : undefined}
              />
              {totalOutcomes === 0 && (
                <div className="text-sm text-[#64748B]">No disputes in window.</div>
              )}
            </div>
          </div>
        </div>

        {/* Disputes by payment method — joined from shopify_orders */}
        <div className="border border-[#E2E8F0] rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[#64748B]" />
              Disputes by payment method ({periodVerbose})
            </h3>
            {uncharted > 0 && (
              <span
                className="text-xs text-[#94A3B8]"
                title={[
                  pm.unknown > 0
                    ? `${pm.unknown} synced but with no payment method recorded`
                    : null,
                  pm.unmatched > 0
                    ? `${pm.unmatched} whose order isn't in shopify_orders yet (backfill gap)`
                    : null,
                  "Both are coverage gaps, not payment methods — excluded from the split below.",
                ]
                  .filter(Boolean)
                  .join(". ")}
              >
                {uncharted} not classified
              </span>
            )}
          </div>
          {totalPaymentMethods > 0 ? (
            <div className="space-y-3">
              {paymentRows.map((row) => (
                <BreakdownRow
                  key={row.key}
                  icon={<CreditCard className="w-4 h-4 text-[#64748B]" />}
                  label={row.label}
                  count={row.count}
                  total={totalPaymentMethods}
                  barClass={row.barClass}
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-[#64748B]">
              {uncharted > 0
                ? "Payment method unavailable — no method recorded on the linked orders."
                : "No disputes in window."}
            </div>
          )}

          {/* Klarna sub-product split — nested under the method card,
              only when there are Klarna disputes with a captured
              sub-product. pay_later is the higher-risk product. */}
          {klarnaSubTotal > 0 && (
            <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
              <h4 className="text-xs font-semibold text-[#475569] mb-3 flex items-center gap-2">
                Klarna sub-product split
                <span className="font-normal text-[#94A3B8]">
                  ({klarnaSubTotal} of {pm.klarna} Klarna)
                </span>
              </h4>
              <div className="space-y-3">
                {klarnaSubRows.map((row) => (
                  <BreakdownRow
                    key={row.key}
                    icon={<CreditCard className="w-4 h-4 text-[#64748B]" />}
                    label={row.label}
                    count={row.count}
                    total={klarnaSubTotal}
                    barClass={row.barClass}
                  />
                ))}
              </div>
              {ksp.klarna_unspecified > 0 && (
                <p className="text-xs text-[#94A3B8] mt-2">
                  &ldquo;Unspecified&rdquo; = Klarna disputes whose order recorded only the
                  bare <code>klarna</code> method (sub-product not captured).
                </p>
              )}
            </div>
          )}
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

          {/* h-40 bars + horizontal label row underneath. Labels are
              compact "MMM D" so they fit flat without rotation. */}
          <div className="flex items-stretch justify-between gap-1">
            {data.trend.map((point, i) => (
              <div key={i} className="flex-1 flex flex-col items-center min-w-0">
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
                <div className="w-full flex items-start justify-center pt-2">
                  <span
                    className="text-[10px] text-[#64748B] text-center leading-tight"
                    title={point.bucketStart}
                  >
                    {formatBucketLabel(point.bucketStart)}
                  </span>
                </div>
              </div>
            ))}
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
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  barClass: string;
  /** Optional muted "N cb · M inq" phase split shown next to count. */
  suffix?: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm text-[#0F172A]">{label}</span>
        </div>
        <div className="flex items-baseline gap-2">
          {suffix && <span className="text-[11px] text-[#94A3B8]">{suffix}</span>}
          <span className="text-sm font-semibold text-[#0F172A]">{count}</span>
        </div>
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
  suffix,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  helper: string;
  count: number;
  countColor: string;
  /** Optional muted "N cb · M inq" phase split. */
  suffix?: string;
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
      <div className="flex items-baseline gap-2">
        {suffix && <span className="text-[11px] text-[#94A3B8]">{suffix}</span>}
        <div className={`text-xl font-bold ${countColor}`}>{count}</div>
      </div>
    </div>
  );
}

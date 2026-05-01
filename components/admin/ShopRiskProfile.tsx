"use client";

/**
 * Admin "Risk profile" section on /admin/shops/[id] (PRD §9).
 *
 * Renders 30d/90d chargeback rates, totals, reason mix, outcome mix,
 * weekly dispute velocity sparkline, inquiry-vs-chargeback ratio, and
 * sync freshness — all sourced from /api/admin/shops/[id]/risk which
 * reads from `shop_daily_metrics` (no live Shopify calls).
 *
 * When the snapshot pipeline hasn't filled the window (fresh install
 * during 90-day backfill), the component surfaces a clear
 * "Calculating…" state per the PRD §6 fallback rule.
 */

import { useEffect, useState } from "react";
import { Sparkline } from "./Sparkline";

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

interface ShopRiskProfileResponse {
  shopId: string;
  rate30d: ChargebackRateResult;
  rate90d: ChargebackRateResult;
  totalDisputes90d: number;
  totalOrders90d: number;
  amountAtRisk: number;
  currencyCode: string;
  reasonBreakdown: { fraud: number; fulfillment: number; other: number };
  outcomeBreakdown: { won: number; lost: number; pending: number };
  inquiryCount90d: number;
  chargebackCount90d: number;
  weeklyTrend: Array<{ weekStart: string; disputeCount: number }>;
  lastSyncedAt: string | null;
}

function thresholdTone(rate: number | null): "healthy" | "watch" | "high" | null {
  if (rate === null) return null;
  if (rate < 0.6) return "healthy";
  if (rate <= 0.9) return "watch";
  return "high";
}

const TONE_CLASS: Record<"healthy" | "watch" | "high", string> = {
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
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function RateCard({
  label,
  result,
}: {
  label: string;
  result: ChargebackRateResult;
}) {
  const band = thresholdTone(result.rate);
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
      <div className="text-sm text-[#64748B] mb-2">{label}</div>
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <div className="text-2xl font-bold text-[#0F172A]">{formatRate(result)}</div>
        {band && (
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-md ${TONE_CLASS[band]}`}
          >
            {TONE_LABEL[band]}
          </span>
        )}
      </div>
      {result.available ? (
        <div className="text-xs text-[#64748B]">
          {result.lowVolume
            ? "Low volume — rate may be volatile"
            : `${formatNumber(result.numerator)} chargebacks / ${formatNumber(result.denominator)} orders`}
        </div>
      ) : (
        <div className="text-xs text-[#64748B]">
          Calculating… ({result.daysCovered}/{result.daysExpected} days)
        </div>
      )}
      {result.rateChange !== null && (
        <div
          className={`text-xs font-medium mt-1 ${
            result.rateChange > 0
              ? "text-[#991B1B]"
              : result.rateChange < 0
                ? "text-[#065F46]"
                : "text-[#64748B]"
          }`}
        >
          {result.rateChange > 0 ? "+" : ""}
          {result.rateChange.toFixed(2)} pp vs prior period
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-5">
      <div className="text-sm text-[#64748B] mb-1">{label}</div>
      <div className="text-2xl font-bold text-[#0F172A]">{value}</div>
      {helper && <div className="text-xs text-[#64748B] mt-1">{helper}</div>}
    </div>
  );
}

function BreakdownBar({
  segments,
  total,
}: {
  segments: Array<{ label: string; count: number; tone: "good" | "neutral" | "bad" | "info" }>;
  total: number;
}) {
  const TONE_BG: Record<"good" | "neutral" | "bad" | "info", string> = {
    good: "bg-[#10B981]",
    neutral: "bg-[#94A3B8]",
    bad: "bg-[#EF4444]",
    info: "bg-[#1D4ED8]",
  };
  if (total === 0) {
    return <div className="text-sm text-[#64748B]">No disputes in window</div>;
  }
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[#F1F5F9]">
        {segments.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={s.label}
              className={`${TONE_BG[s.tone]}`}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${s.count}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s) => {
          const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          return (
            <div key={s.label} className="text-xs text-[#64748B]">
              <span className={`inline-block w-2 h-2 rounded-full ${TONE_BG[s.tone]} mr-1.5 align-middle`} />
              {s.label}: <span className="font-semibold text-[#0F172A]">{s.count}</span>
              {" "}
              <span className="text-[#94A3B8]">({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  shopId: string;
}

export function ShopRiskProfile({ shopId }: Props) {
  const [data, setData] = useState<ShopRiskProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/admin/shops/${shopId}/risk`)
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
  }, [shopId]);

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
      <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#0F172A] mb-2">Risk profile</h3>
        <div className="text-sm text-[#64748B]">Loading risk profile…</div>
      </div>
    );
  }

  const trendValues = data.weeklyTrend.map((w) => w.disputeCount);
  const totalReasonClassified =
    data.reasonBreakdown.fraud +
    data.reasonBreakdown.fulfillment +
    data.reasonBreakdown.other;
  const totalOutcomeClassified =
    data.outcomeBreakdown.won + data.outcomeBreakdown.lost + data.outcomeBreakdown.pending;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-lg font-semibold text-[#0F172A]">Risk profile</h3>
        <div className="text-xs text-[#64748B]">
          Snapshot: {data.lastSyncedAt ? formatRelativeTime(data.lastSyncedAt) : "Calculating…"}
        </div>
      </div>

      {/* Snapshot row */}
      <div className="grid gap-4 mb-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <RateCard label="Chargeback rate (30d)" result={data.rate30d} />
        <RateCard label="Chargeback rate (90d)" result={data.rate90d} />
        <StatTile
          label="Total disputes (90d)"
          value={formatNumber(data.totalDisputes90d)}
          helper={`${data.chargebackCount90d} chargebacks · ${data.inquiryCount90d} inquiries`}
        />
        <StatTile
          label="Total orders (90d)"
          value={formatNumber(data.totalOrders90d)}
          helper={
            data.rate90d.available
              ? `${data.rate90d.daysCovered}/${data.rate90d.daysExpected} days snapshotted`
              : "Calculating…"
          }
        />
        <StatTile
          label="Amount at risk"
          value={formatCurrency(data.amountAtRisk, data.currencyCode)}
          helper="Active disputes only"
        />
      </div>

      {/* Reason + outcome breakdowns */}
      <div className="grid gap-4 mb-6 grid-cols-1 lg:grid-cols-2">
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-5">
          <div className="text-sm font-semibold text-[#0F172A] mb-3">
            Dispute reasons (90d)
          </div>
          <BreakdownBar
            segments={[
              { label: "Fraud", count: data.reasonBreakdown.fraud, tone: "bad" },
              { label: "Item not received", count: data.reasonBreakdown.fulfillment, tone: "info" },
              { label: "Other", count: data.reasonBreakdown.other, tone: "neutral" },
            ]}
            total={totalReasonClassified}
          />
        </div>
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-5">
          <div className="text-sm font-semibold text-[#0F172A] mb-3">
            Outcomes (90d)
          </div>
          <BreakdownBar
            segments={[
              { label: "Won", count: data.outcomeBreakdown.won, tone: "good" },
              { label: "Lost", count: data.outcomeBreakdown.lost, tone: "bad" },
              { label: "Pending", count: data.outcomeBreakdown.pending, tone: "neutral" },
            ]}
            total={totalOutcomeClassified}
          />
        </div>
      </div>

      {/* Weekly trend sparkline */}
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-sm font-semibold text-[#0F172A]">
            Dispute velocity (90d, weekly)
          </div>
          <div className="text-xs text-[#64748B]">
            Peak: {Math.max(0, ...trendValues)} disputes / week
          </div>
        </div>
        <Sparkline
          data={trendValues}
          width={520}
          height={56}
          ariaLabel="Weekly dispute count over the trailing 90 days"
        />
        <div className="flex justify-between text-[10px] text-[#94A3B8] mt-1">
          <span>{data.weeklyTrend[0]?.weekStart ?? ""}</span>
          <span>{data.weeklyTrend.at(-1)?.weekStart ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

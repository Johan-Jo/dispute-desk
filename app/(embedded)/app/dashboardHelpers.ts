import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { CbInqSplit } from "@/lib/disputes/metrics";
import { safeDynamicT } from "@/lib/i18n/safeDynamicT";

export type { CbInqSplit };

export type PeriodKey = "24h" | "7d" | "30d" | "all";

export interface ActivityItem {
  id: string;
  disputeId: string;
  orderName: string;
  eventType: string;
  description: string | null;
  eventAt: string;
  actorType: string;
}

export interface DashboardStats {
  activeDisputes: number;
  winRate: number;
  packCount: number;
  amountAtRisk: number;
  amountRecovered: number;
  amountLost: number;
  currencyCode: string;
  /** Counts of disputes in the window denominated in currencies other
   *  than `currencyCode`. The dashboard tiles only sum amounts in the
   *  primary currency (cross-currency sums are nonsense); this map
   *  feeds the "+ N in EUR, M in SEK" hint so the omission is visible
   *  instead of silent. Empty when all disputes share one currency. */
  otherCurrencyCounts: Record<string, number>;
  disputesWon: number;
  disputesLost: number;
  totalClosed: number;
  avgTimeToSubmit: number | null;
  avgTimeToClose: number | null;
  activeDisputesChange: number | null;
  winRateChange: number | null;
  amountAtRiskChange: number | null;
  amountRecoveredChange: number | null;
  disputesWonChange: number | null;
  inquiryCount: number;
  chargebackCount: number;
  needsAttentionCount: number;
  // ── Inquiry/chargeback splits (Dashboard v3) ─────────────────────
  // Per-metric cb·inq breakdown so each dashboard card can show a modest
  // "N cb · N inq" line. `*Split` come from computeDisputeMetrics;
  // operationalSplit comes from the stats route's operational scan.
  // closedSplit is window-scoped (from metrics, sums to totalClosed).
  // Every split reconciles with its headline number.
  activeSplit: CbInqSplit;
  atRiskSplit: CbInqSplit;
  winSplit: CbInqSplit;
  recoveredSplit: CbInqSplit;
  closedSplit: CbInqSplit;
  outcomeSplit: Record<string, CbInqSplit>;
  operationalSplit: Record<string, CbInqSplit>;
  // Dashboard v3 perf-tile additions
  winRatePctSplit: CbInqSplit;
  disputeRate: number | null;
  disputeRateCbPct: number | null;
  disputeRateInqPct: number | null;
  statusBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  operationalBreakdown: Record<string, number>;
  operationalClosedCount: number;
  actionNeededDisputeId: string | null;
  submissionBreakdown: Record<string, number>;
  winRateTrend: number[];
  disputeCategories: { label: string; value: number; cb: number; inq: number }[];
  recentActivity: ActivityItem[];

  // ── Shared presentation model (design-alignment plan §4) ─────────
  /** Mutually-exclusive operational partition, precedence Closed →
   *  Under review → Action required → Building & monitoring. The
   *  Closed cell is windowed by the selected period; the three open
   *  cells are point-in-time snapshots. */
  operationalBuckets?: Record<
    "building_monitoring" | "action_required" | "under_review" | "closed",
    { count: number; cb: number; inq: number }
  >;
  /** Genuine merchant tasks only (blocking / requested /
   *  merchant-resolvable technical errors) — drives the banner. NOT
   *  the legacy needs_attention count. */
  merchantActionCount?: number;

  // ── Chargeback rate (PRD §8) ─────────────────────────────────────
  // Rate is null when the snapshot is missing for the window — UI
  // renders "—" + "Calculating…" rather than a misleading 0%.
  chargebackRate: number | null;
  chargebackRateChange: number | null;
  chargebackRateNumerator: number;
  chargebackRateDenominator: number;
  chargebackRateAvailable: boolean;
  chargebackRateLowVolume: boolean;
  chargebackRateLastSyncedAt: string | null;
}

export const DEFAULT_STATS: DashboardStats = {
  activeDisputes: 0,
  winRate: 0,
  packCount: 0,
  amountAtRisk: 0,
  amountRecovered: 0,
  amountLost: 0,
  currencyCode: "USD",
  otherCurrencyCounts: {},
  disputesWon: 0,
  disputesLost: 0,
  totalClosed: 0,
  avgTimeToSubmit: null,
  avgTimeToClose: null,
  activeDisputesChange: null,
  winRateChange: null,
  amountAtRiskChange: null,
  amountRecoveredChange: null,
  disputesWonChange: null,
  inquiryCount: 0,
  chargebackCount: 0,
  needsAttentionCount: 0,
  activeSplit: { cb: 0, inq: 0 },
  atRiskSplit: { cb: 0, inq: 0 },
  winSplit: { cb: 0, inq: 0 },
  recoveredSplit: { cb: 0, inq: 0 },
  closedSplit: { cb: 0, inq: 0 },
  outcomeSplit: {},
  operationalSplit: {},
  winRatePctSplit: { cb: 0, inq: 0 },
  disputeRate: null,
  disputeRateCbPct: null,
  disputeRateInqPct: null,
  statusBreakdown: {},
  outcomeBreakdown: {},
  operationalBreakdown: {},
  operationalClosedCount: 0,
  actionNeededDisputeId: null,
  submissionBreakdown: {},
  winRateTrend: [0, 0, 0, 0, 0, 0],
  disputeCategories: [],
  recentActivity: [],
  chargebackRate: null,
  chargebackRateChange: null,
  chargebackRateNumerator: 0,
  chargebackRateDenominator: 0,
  chargebackRateAvailable: false,
  chargebackRateLowVolume: false,
  chargebackRateLastSyncedAt: null,
};

export function useDateLocale() {
  const locale = useLocale();
  return useMemo(() => {
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("de")) return "de-DE";
    if (locale.startsWith("sv")) return "sv-SE";
    if (locale.startsWith("es")) return "es-ES";
    if (locale.startsWith("fr")) return "fr-FR";
    return "en-US";
  }, [locale]);
}

export function useFormatCurrency(currencyCode: string) {
  const dateLocale = useDateLocale();
  return useCallback(
    (amount: number, maxFrac = 0) =>
      new Intl.NumberFormat(dateLocale, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: maxFrac,
      }).format(amount),
    [dateLocale, currencyCode],
  );
}

// Missing-key-safe status/outcome labels. Both previously hardcoded a
// `startsWith("disputeTimeline.")` miss check — correct only while the
// caller's translator happens to be scoped to that exact namespace. The
// shared helper detects a miss for any translator scope.
export function safeStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
): string {
  return safeDynamicT(t, `normalizedStatuses.${status}`, status.replace(/_/g, " "));
}

export function safeOutcomeLabel(
  t: ReturnType<typeof useTranslations>,
  outcome: string,
): string {
  return safeDynamicT(t, `outcomes.${outcome}`, outcome.replace(/_/g, " "));
}

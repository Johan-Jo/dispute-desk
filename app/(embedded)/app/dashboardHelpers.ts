import { useCallback, useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

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
  statusBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  operationalBreakdown: Record<string, number>;
  operationalClosedCount: number;
  actionNeededDisputeId: string | null;
  submissionBreakdown: Record<string, number>;
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
  recentActivity: ActivityItem[];

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

export function safeStatusLabel(
  t: ReturnType<typeof useTranslations>,
  status: string,
): string {
  try {
    const result = t(`normalizedStatuses.${status}`);
    if (result.startsWith("disputeTimeline.")) return status.replace(/_/g, " ");
    return result;
  } catch {
    return status.replace(/_/g, " ");
  }
}

export function safeOutcomeLabel(
  t: ReturnType<typeof useTranslations>,
  outcome: string,
): string {
  try {
    const result = t(`outcomes.${outcome}`);
    if (result.startsWith("disputeTimeline.")) return outcome.replace(/_/g, " ");
    return result;
  } catch {
    return outcome.replace(/_/g, " ");
  }
}

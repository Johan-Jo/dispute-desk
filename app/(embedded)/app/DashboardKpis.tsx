"use client";

import { useTranslations } from "next-intl";
import { BlockStack, Icon, Text, useBreakpoints } from "@shopify/polaris";
import {
  AlertCircleIcon,
  CashDollarIcon,
  ChartLineIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import styles from "./dashboard.module.css";
import {
  useDateLocale,
  useFormatCurrency,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";

/** Threshold-tone tuple per PRD §8. Same order/colors as the
 *  status hero in OverviewTab so merchants get a consistent
 *  green-amber-red signal across surfaces. */
type ThresholdTone = "healthy" | "watch" | "high";

function classifyChargebackRate(rate: number | null): ThresholdTone | null {
  if (rate === null) return null;
  if (rate < 0.6) return "healthy";
  if (rate <= 0.9) return "watch";
  return "high";
}

const TONE_PALETTE: Record<ThresholdTone, { bg: string; color: string; label: string }> = {
  healthy: { bg: "#D1FAE5", color: "#065F46", label: "" },
  watch:   { bg: "#FEF3C7", color: "#92400E", label: "" },
  high:    { bg: "#FEE2E2", color: "#991B1B", label: "" },
};

function ChangeIndicator({
  value,
  label,
  inverse = false,
}: {
  value: number | null;
  label: string;
  /** When true, "up = bad" (red) and "down = good" (green). Used for
   *  metrics where an increase is the negative outcome — chargeback
   *  rate, error rate, etc. Defaults false to preserve the existing
   *  active-disputes / win-rate / amount-at-risk semantics. */
  inverse?: boolean;
}) {
  if (value === null || value === undefined) return null;
  const isPositive = value > 0;
  const isNegative = value < 0;
  const goodColor = "#10B981";
  const badColor = "#EF4444";
  const color = isPositive
    ? (inverse ? badColor : goodColor)
    : isNegative
      ? (inverse ? goodColor : badColor)
      : "#9CA3AF";
  return (
    <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
      <span style={{ fontWeight: 500, color }}>
        {isPositive ? "+" : ""}{value}%
      </span>
      <span style={{ color: "#9CA3AF" }}>{label}</span>
    </span>
  );
}

function PeriodSelector({
  period,
  onChange,
  t,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const periodLabel = (key: PeriodKey) => t(`dashboard.period${key === "all" ? "All" : key}`);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
      {(["24h", "7d", "30d", "all"] as const).map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "4px 12px",
            borderRadius: "6px",
            border: period === key ? "none" : "1px solid #E5E7EB",
            background: period === key ? "#111827" : "transparent",
            color: period === key ? "#fff" : "#374151",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {periodLabel(key)}
        </button>
      ))}
    </div>
  );
}

interface KpiCard {
  icon: typeof AlertCircleIcon;
  label: string;
  value: string;
  change: number | null;
  /** When true, "up = bad" for the change indicator. */
  changeInverse?: boolean;
  /** Optional descriptor below the value (e.g. "12 disputes / 1,460
   *  orders" on the chargeback rate tile). */
  subtext?: string;
  /** Optional inline pill rendered to the right of the value. Used by
   *  the chargeback rate tile to surface the Healthy / Watch / High
   *  risk threshold band per PRD §8. */
  badge?: { label: string; tone: ThresholdTone };
  /** Replaces the value with the supplied helper string when true.
   *  Used when a snapshot is missing for the window — UI shows
   *  "Calculating…" instead of a misleading 0%. */
  unavailable?: { value: string; helper: string };
}

function DesktopKpiTile({ card, vsLabel, loading }: { card: KpiCard; vsLabel: string; loading: boolean }) {
  const display = card.unavailable ? card.unavailable.value : (loading ? "—" : card.value);
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "10px",
        border: "1px solid #E5E7EB",
        padding: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <p style={{ fontSize: "12px", fontWeight: 500, color: "#374151", margin: 0 }}>{card.label}</p>
        <div style={{
          width: "32px",
          height: "32px",
          borderRadius: "8px",
          background: "#DBEAFE",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "#1D4ED8",
        }}>
          <Icon source={card.icon} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <p style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>
          {display}
        </p>
        {card.badge && !card.unavailable && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              lineHeight: 1.4,
              background: TONE_PALETTE[card.badge.tone].bg,
              color: TONE_PALETTE[card.badge.tone].color,
              whiteSpace: "nowrap",
            }}
          >
            {card.badge.label}
          </span>
        )}
      </div>
      {(card.subtext || card.unavailable) && (
        <p style={{ fontSize: "12px", color: "#6D7175", margin: "4px 0 0", lineHeight: 1.4 }}>
          {card.unavailable ? card.unavailable.helper : card.subtext}
        </p>
      )}
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator
          value={card.change}
          label={vsLabel}
          inverse={card.changeInverse}
        />
      </div>
    </div>
  );
}

function MobileKpiTile({
  card,
  vsLabel,
  loading,
  critical,
}: {
  card: KpiCard;
  vsLabel: string;
  loading: boolean;
  critical?: boolean;
}) {
  const display = card.unavailable ? card.unavailable.value : (loading ? "—" : card.value);
  return (
    <div className={`${styles.kpiTileMobile} ${critical ? styles.kpiHeroTileRisk : ""}`}>
      <div className={styles.header}>
        <p className={styles.label}>{card.label}</p>
        <div className={styles.iconChip}>
          <Icon source={card.icon} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <p className={styles.value}>{display}</p>
        {card.badge && !card.unavailable && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              lineHeight: 1.4,
              background: TONE_PALETTE[card.badge.tone].bg,
              color: TONE_PALETTE[card.badge.tone].color,
              whiteSpace: "nowrap",
            }}
          >
            {card.badge.label}
          </span>
        )}
      </div>
      {(card.subtext || card.unavailable) && (
        <p style={{ fontSize: "12px", color: "#6D7175", margin: "4px 0 0", lineHeight: 1.4 }}>
          {card.unavailable ? card.unavailable.helper : card.subtext}
        </p>
      )}
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator
          value={card.change}
          label={vsLabel}
          inverse={card.changeInverse}
        />
      </div>
    </div>
  );
}

interface Props {
  stats: DashboardStats;
  loading: boolean;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
}

export function DashboardKpis({ stats, loading, period, onPeriodChange }: Props) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency(stats.currencyCode);
  const vsLabel = t("dashboard.vsLastMonth");
  const { smDown } = useBreakpoints();

  const active: KpiCard = {
    icon: AlertCircleIcon,
    label: t("dashboard.activeDisputes"),
    value: String(stats.activeDisputes),
    change: stats.activeDisputesChange,
  };
  const winRate: KpiCard = {
    icon: ChartLineIcon,
    label: t("dashboard.winRate"),
    value: `${stats.winRate}%`,
    change: stats.winRateChange,
  };
  const recovered: KpiCard = {
    icon: CashDollarIcon,
    label: t("dashboard.amountRecovered"),
    value: formatCurrency(stats.amountRecovered),
    change: stats.amountRecoveredChange,
  };
  const lost: KpiCard = {
    icon: CashDollarIcon,
    label: t("dashboard.amountLostKpi"),
    value: formatCurrency(stats.amountLost),
    change: null,
  };
  const atRisk: KpiCard = {
    icon: CashDollarIcon,
    label: t("dashboard.amountAtRisk"),
    value: formatCurrency(stats.amountAtRisk),
    change: stats.amountAtRiskChange,
  };

  // ── Chargeback rate (PRD §8) ────────────────────────────────────────
  // Read directly from the snapshot-fed metrics. When `available` is
  // false the snapshot pipeline hasn't filled the window yet (fresh
  // install during backfill, or recently uninstalled+reinstalled);
  // surface "Calculating…" rather than a misleading "0.00%".
  const dateLocale = useDateLocale();
  const numberFmt = (n: number) => new Intl.NumberFormat(dateLocale).format(n);
  const chargebackBand = classifyChargebackRate(stats.chargebackRate);
  const chargebackBadgeLabel =
    chargebackBand === "healthy"
      ? t("dashboard.chargebackRateThresholdHealthy")
      : chargebackBand === "watch"
        ? t("dashboard.chargebackRateThresholdWatch")
        : chargebackBand === "high"
          ? t("dashboard.chargebackRateThresholdHigh")
          : null;
  const chargebackSubtext = stats.chargebackRateAvailable
    ? (stats.chargebackRateLowVolume
        ? t("dashboard.chargebackRateLowVolume")
        : t("dashboard.chargebackRateSubtext", {
            numerator: numberFmt(stats.chargebackRateNumerator),
            denominator: numberFmt(stats.chargebackRateDenominator),
          }))
    : undefined;
  const chargebackRate: KpiCard = {
    icon: ShieldCheckMarkIcon,
    label: t("dashboard.chargebackRate"),
    value: stats.chargebackRate !== null ? `${stats.chargebackRate.toFixed(2)}%` : "—",
    change: stats.chargebackRateChange,
    changeInverse: true,
    subtext: chargebackSubtext,
    badge:
      chargebackBand && chargebackBadgeLabel
        ? { label: chargebackBadgeLabel, tone: chargebackBand }
        : undefined,
    unavailable: !stats.chargebackRateAvailable
      ? {
          value: "—",
          helper: t("dashboard.chargebackRateUnavailable"),
        }
      : undefined,
  };

  const desktopCards = [active, winRate, recovered, atRisk, chargebackRate];

  return (
    <div style={{
      background: "#fff",
      borderRadius: "12px",
      border: "1px solid #E5E7EB",
      padding: smDown ? "16px" : "20px",
    }}>
      {smDown ? (
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">{t("dashboard.performanceOverview")}</Text>
          <PeriodSelector period={period} onChange={onPeriodChange} t={t} />
          <div className={styles.mobileStack}>
            {/* Hero: Amount at Risk, full-width */}
            <MobileKpiTile
              card={atRisk}
              vsLabel={vsLabel}
              loading={loading}
              critical={stats.amountAtRisk > 0}
            />
            {/* Row 2: Win Rate · Active */}
            <div className={styles.mobileGrid2}>
              <MobileKpiTile card={winRate} vsLabel={vsLabel} loading={loading} />
              <MobileKpiTile card={active} vsLabel={vsLabel} loading={loading} />
            </div>
            {/* Row 3: Recovered · Lost */}
            <div className={styles.mobileGrid2}>
              <MobileKpiTile card={recovered} vsLabel={vsLabel} loading={loading} />
              <MobileKpiTile card={lost} vsLabel={vsLabel} loading={loading} />
            </div>
            {/* Row 4: Chargeback Rate (full width — risk metric warrants
                its own row so the threshold pill + subtext don't
                truncate inside a 2-column grid) */}
            <MobileKpiTile card={chargebackRate} vsLabel={vsLabel} loading={loading} />
          </div>
        </BlockStack>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
            <Text as="h2" variant="headingMd">{t("dashboard.performanceOverview")}</Text>
            <PeriodSelector period={period} onChange={onPeriodChange} t={t} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
            {desktopCards.map((card) => (
              <DesktopKpiTile key={card.label} card={card} vsLabel={vsLabel} loading={loading} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}


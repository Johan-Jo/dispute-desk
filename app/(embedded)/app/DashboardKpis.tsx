"use client";

import { useTranslations } from "next-intl";
import { BlockStack, Icon, Text, useBreakpoints } from "@shopify/polaris";
import {
  AlertCircleIcon,
  CashDollarIcon,
  ChartLineIcon,
} from "@shopify/polaris-icons";
import styles from "./dashboard.module.css";
import {
  useFormatCurrency,
  type CbInqSplit,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";
import { CbInqBreakdown, CbInqKey } from "./CbInqBreakdown";

function ChangeIndicator({
  value,
  label,
  inverse = false,
  unit = "%",
}: {
  value: number | null;
  label: string;
  /** When true, "up = bad" (red) and "down = good" (green). Used for
   *  metrics where an increase is the negative outcome — chargeback
   *  rate, error rate, etc. Defaults false to preserve the existing
   *  active-disputes / win-rate / amount-at-risk semantics. */
  inverse?: boolean;
  /** Display unit for the delta. Existing tiles render `%`; chargeback
   *  rate renders `pp` (percentage points) per PRD §7. */
  unit?: "%" | "pp";
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
  const formatted = unit === "pp" ? value.toFixed(1) : String(value);
  const suffix = unit === "pp" ? " pp" : "%";
  return (
    <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
      <span style={{ fontWeight: 500, color }}>
        {isPositive ? "+" : ""}{formatted}{suffix}
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
  /** Display unit for the change indicator. Defaults to `%`; chargeback
   *  rate uses `pp` per PRD §7. */
  changeUnit?: "%" | "pp";
  /** Optional subdued line below the change indicator. Used by the
   *  3 currency-denominated tiles (Recovered / Lost / At Risk) to
   *  declare disputes in other currencies that aren't included in the
   *  headline number — e.g. "+ 12 in SEK, 1 in GBP". Empty/omitted
   *  when all disputes share the primary currency. */
  hint?: string | null;
  /** cb·inq footer (Dashboard v3). Transcribed from the design's
   *  `.Perf-foot` per tile: count tiles show "0 cb · 0 inq" (labelFirst
   *  false), rate tiles show "cb 0% · inq 0%" (labelFirst true,
   *  hideWhenZero false), money tiles show "$0 · $0" (hideLabel true). */
  breakdown?: {
    split: CbInqSplit;
    format?: (v: number) => string;
    labelFirst?: boolean;
    hideWhenZero?: boolean;
    hideLabel?: boolean;
  } | null;
}

function DesktopKpiTile({ card, vsLabel, loading }: { card: KpiCard; vsLabel: string; loading: boolean }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "10px",
        border: "1px solid #E5E7EB",
        padding: "16px",
        // Equal-height flex column so the footer divider sits on the same
        // baseline across all five tiles regardless of content above it.
        height: "100%",
        display: "flex",
        flexDirection: "column",
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
          {loading ? "—" : card.value}
        </p>
      </div>
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator
          value={card.change}
          label={vsLabel}
          inverse={card.changeInverse}
          unit={card.changeUnit}
        />
      </div>
      {card.hint && (
        <div style={{ marginTop: "4px", fontSize: "11px", color: "#6D7175", lineHeight: 1.4 }}>
          {card.hint}
        </div>
      )}
      {card.breakdown && (
        <div style={{ marginTop: "auto", paddingTop: "9px", borderTop: "1px solid #EEEFF1" }}>
          <CbInqBreakdown
            split={card.breakdown.split}
            formatValue={card.breakdown.format}
            labelFirst={card.breakdown.labelFirst}
            hideWhenZero={card.breakdown.hideWhenZero}
            hideLabel={card.breakdown.hideLabel}
          />
        </div>
      )}
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
  return (
    <div className={`${styles.kpiTileMobile} ${critical ? styles.kpiHeroTileRisk : ""}`}>
      <div className={styles.header}>
        <p className={styles.label}>{card.label}</p>
        <div className={styles.iconChip}>
          <Icon source={card.icon} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <p className={styles.value}>{loading ? "—" : card.value}</p>
      </div>
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator
          value={card.change}
          label={vsLabel}
          inverse={card.changeInverse}
          unit={card.changeUnit}
        />
      </div>
      {card.hint && (
        <div style={{ marginTop: "4px", fontSize: "11px", color: "#6D7175", lineHeight: 1.4 }}>
          {card.hint}
        </div>
      )}
      {card.breakdown && (
        <div style={{ marginTop: "auto", paddingTop: "9px", borderTop: "1px solid #EEEFF1" }}>
          <CbInqBreakdown
            split={card.breakdown.split}
            formatValue={card.breakdown.format}
            labelFirst={card.breakdown.labelFirst}
            hideWhenZero={card.breakdown.hideWhenZero}
            hideLabel={card.breakdown.hideLabel}
          />
        </div>
      )}
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

  // Mixed-currency hint — declares disputes NOT included in the
  // currency tile totals because their currency differs from the
  // primary (most-frequent) one. Renders e.g. "+ 12 in SEK, 1 in GBP".
  // Empty string when all disputes share the primary currency, in
  // which case the tile renders no extra line.
  const otherCurrencyHint = (() => {
    const entries = Object.entries(stats.otherCurrencyCounts ?? {})
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return null;
    const parts = entries.map(([code, count]) =>
      t("dashboard.otherCurrencyEntry", { count, currency: code }),
    );
    return t("dashboard.otherCurrencyHint", { list: parts.join(", ") });
  })();

  // Perf-tile footers transcribed literally from Dashboard v3 .Perf-foot:
  //   Active:       "0 cb · 0 inq"      (count, value-first, with text)
  //   Win Rate:     "cb 0% · inq 0%"    (rate, label-first, with text)
  //   Recovered:    "$0 · $0"           (money, no text)
  //   At Risk:      "$0 · $0"           (money, no text)
  //   Dispute rate: "cb 0% · inq 0%"    (rate, label-first, with text)
  const active: KpiCard = {
    icon: AlertCircleIcon,
    label: t("dashboard.activeDisputes"),
    value: String(stats.activeDisputes),
    change: stats.activeDisputesChange,
    changeInverse: true,
    breakdown: { split: stats.activeSplit },
  };
  // No decided disputes in the window → show "—", NOT "0%". A literal
  // 0% reads as "we lose every dispute" when the truth is "nothing was
  // decided in this period" (e.g. the 24h view of a shop whose wins
  // closed last week).
  const hasDecidedDisputes = stats.disputesWon + stats.disputesLost > 0;
  const winRate: KpiCard = {
    icon: ChartLineIcon,
    label: t("dashboard.winRate"),
    value: hasDecidedDisputes ? `${stats.winRate}%` : "—",
    change: stats.winRateChange,
    // Denominator disclosure (plan §13.1 decision): accepted counts as
    // a loss; refunded is excluded. The label must never leave the
    // definition ambiguous.
    hint: t("dashboard.winRateDenominatorNote"),
    breakdown: {
      split: stats.winRatePctSplit,
      format: (v) => `${v}%`,
      labelFirst: true,
      hideWhenZero: false,
    },
  };
  const recovered: KpiCard = {
    icon: CashDollarIcon,
    label: t("dashboard.recoveredShort"),
    value: formatCurrency(stats.amountRecovered),
    change: stats.amountRecoveredChange,
    hint: otherCurrencyHint,
    breakdown: {
      split: stats.recoveredSplit,
      format: (v) => formatCurrency(v),
      hideLabel: true,
    },
  };
  const lost: KpiCard = {
    icon: CashDollarIcon,
    label: t("dashboard.amountLostKpi"),
    value: formatCurrency(stats.amountLost),
    change: null,
    hint: otherCurrencyHint,
  };
  const atRisk: KpiCard = {
    icon: CashDollarIcon,
    label: t("dashboard.atRiskShort"),
    value: formatCurrency(stats.amountAtRisk),
    change: stats.amountAtRiskChange,
    changeInverse: true,
    hint: otherCurrencyHint,
    breakdown: {
      split: stats.atRiskSplit,
      format: (v) => formatCurrency(v),
      hideLabel: true,
    },
  };

  // ── Dispute rate (Dashboard v3) ─────────────────────────────────────
  // 5th performance tile: ALL disputes (chargebacks + inquiries) as a
  // share of orders, from shop_daily_metrics. cb%/inq% split in the footer.
  // Guard with `!= null` (not `!== null`) so a stale/older API response
  // that omits the field renders "—" instead of "undefined%".
  const disputeRate: KpiCard = {
    icon: ChartLineIcon,
    label: t("dashboard.disputeRate"),
    value: stats.disputeRate != null ? `${stats.disputeRate}%` : "—",
    change: null,
    hint: t("dashboard.allDisputesOverOrders"),
    breakdown:
      stats.disputeRateCbPct != null && stats.disputeRateInqPct != null
        ? {
            split: { cb: stats.disputeRateCbPct, inq: stats.disputeRateInqPct },
            format: (v) => `${v}%`,
            labelFirst: true,
            hideWhenZero: false,
          }
        : null,
  };

  const desktopCards = [active, winRate, recovered, atRisk, disputeRate];

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
          <CbInqKey />
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
            {/* Row 4: Dispute rate — full width on mobile so the
                "all disputes ÷ orders" hint + cb%/inq% footer have room. */}
            <MobileKpiTile card={disputeRate} vsLabel={vsLabel} loading={loading} />
          </div>
        </BlockStack>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
              <Text as="h2" variant="headingMd">{t("dashboard.performanceOverview")}</Text>
              <CbInqKey />
            </div>
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

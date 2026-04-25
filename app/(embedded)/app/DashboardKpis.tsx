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
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";

function ChangeIndicator({ value, label }: { value: number | null; label: string }) {
  if (value === null || value === undefined) return null;
  const isPositive = value > 0;
  const isNegative = value < 0;
  return (
    <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
      <span style={{ fontWeight: 500, color: isPositive ? "#10B981" : isNegative ? "#EF4444" : "#9CA3AF" }}>
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
}

function DesktopKpiTile({ card, vsLabel, loading }: { card: KpiCard; vsLabel: string; loading: boolean }) {
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
      <p style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>
        {loading ? "—" : card.value}
      </p>
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator value={card.change} label={vsLabel} />
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
  return (
    <div className={`${styles.kpiTileMobile} ${critical ? styles.kpiHeroTileRisk : ""}`}>
      <div className={styles.header}>
        <p className={styles.label}>{card.label}</p>
        <div className={styles.iconChip}>
          <Icon source={card.icon} />
        </div>
      </div>
      <p className={styles.value}>{loading ? "—" : card.value}</p>
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator value={card.change} label={vsLabel} />
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

  const desktopCards = [active, winRate, recovered, atRisk];

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


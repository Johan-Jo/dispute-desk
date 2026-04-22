"use client";

import { useTranslations } from "next-intl";
import {
  BlockStack,
  Card,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import {
  useFormatCurrency,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";

function PeriodSelector({
  period,
  onChange,
  t,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const periodLabel = (key: PeriodKey) =>
    t(`dashboard.period${key === "all" ? "All" : key}`);
  return (
    <InlineStack gap="200">
      {(["24h", "7d", "30d", "all"] as const).map((key) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "4px 10px",
            borderRadius: "6px",
            border: period === key ? "none" : "1px solid var(--p-color-border)",
            background:
              period === key
                ? "var(--p-color-bg-fill-brand)"
                : "transparent",
            color:
              period === key
                ? "var(--p-color-text-brand-on-bg-fill)"
                : "var(--p-color-text)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {periodLabel(key)}
        </button>
      ))}
    </InlineStack>
  );
}

function ChangeIndicator({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  if (value === null || value === undefined) return null;
  const tone =
    value > 0 ? "success" : value < 0 ? "critical" : "subdued";
  return (
    <Text as="span" variant="bodySm" tone={tone === "success" ? undefined : tone}>
      <span style={{ color: value > 0 ? "var(--p-color-text-success)" : undefined }}>
        {value > 0 ? "+" : ""}
        {value}% {label}
      </span>
    </Text>
  );
}

interface Props {
  stats: DashboardStats;
  loading: boolean;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
}

export function DashboardKpis({
  stats,
  loading,
  period,
  onPeriodChange,
}: Props) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency(stats.currencyCode);
  const vsLabel = t("dashboard.vsLastMonth");

  const metrics: {
    label: string;
    value: string;
    change: number | null;
  }[] = [
    {
      label: t("dashboard.activeDisputes"),
      value: String(stats.activeDisputes),
      change: stats.activeDisputesChange,
    },
    {
      label: t("dashboard.winRate"),
      value: `${stats.winRate}%`,
      change: stats.winRateChange,
    },
    {
      label: t("dashboard.amountRecovered"),
      value: formatCurrency(stats.amountRecovered),
      change: stats.amountRecoveredChange,
    },
    {
      label: t("dashboard.amountAtRisk"),
      value: formatCurrency(stats.amountAtRisk),
      change: stats.amountAtRiskChange,
    },
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <Text as="h2" variant="headingMd">
            {t("dashboard.performanceOverview")}
          </Text>
          <PeriodSelector period={period} onChange={onPeriodChange} t={t} />
        </InlineStack>
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          {metrics.map((m) => (
            <BlockStack key={m.label} gap="100">
              <Text as="span" variant="bodySm" tone="subdued">
                {m.label}
              </Text>
              <Text as="p" variant="headingLg">
                {loading ? "—" : m.value}
              </Text>
              <ChangeIndicator value={m.change} label={vsLabel} />
            </BlockStack>
          ))}
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}

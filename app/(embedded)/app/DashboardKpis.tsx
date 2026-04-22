"use client";

import { useTranslations } from "next-intl";
import {
  BlockStack,
  Card,
  InlineGrid,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import {
  useFormatCurrency,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";

function ChangeIndicator({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  if (value === null || value === undefined) return null;
  const isPositive = value > 0;
  const isNegative = value < 0;
  const color = isPositive
    ? "var(--p-color-text-success)"
    : isNegative
      ? "var(--p-color-text-critical)"
      : undefined;
  const arrow = isPositive ? "↑" : isNegative ? "↓" : "";
  return (
    <Text as="span" variant="bodySm" tone="subdued">
      <span style={{ color }}>
        {arrow} {Math.abs(value)}% {label}
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

const PERIOD_OPTIONS: { label: string; value: PeriodKey }[] = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "This month", value: "30d" },
  { label: "All time", value: "all" },
];

export function DashboardKpis({
  stats,
  loading,
  period,
  onPeriodChange,
}: Props) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency(stats.currencyCode);
  const vsLabel = t("dashboard.vsLastMonth");

  const periodOptions = PERIOD_OPTIONS.map((o) => ({
    label: t(`dashboard.period${o.value === "all" ? "All" : o.value}`),
    value: o.value,
  }));

  const metrics: {
    label: string;
    value: string;
    change: number | null;
  }[] = [
    {
      label: t("dashboard.winRateSubmitted"),
      value: `${stats.winRate}%`,
      change: stats.winRateChange,
    },
    {
      label: t("dashboard.recoveryRate"),
      value: formatCurrency(stats.amountRecovered),
      change: stats.amountRecoveredChange,
    },
    {
      label: t("dashboard.submissionRate"),
      value: `${stats.submissionRate}%`,
      change: stats.submissionRateChange,
    },
    {
      label: t("dashboard.deadlineMissRate"),
      value: `${stats.deadlineMissRate}%`,
      change: stats.deadlineMissRateChange,
    },
    {
      label: t("dashboard.totalDisputes"),
      value: String(stats.totalDisputes),
      change: stats.activeDisputesChange,
    },
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <Text as="h2" variant="headingMd">
            {t("dashboard.yourPerformance")}
          </Text>
          <div style={{ minWidth: 160 }}>
            <Select
              label=""
              labelHidden
              options={periodOptions}
              value={period}
              onChange={(v) => onPeriodChange(v as PeriodKey)}
            />
          </div>
        </InlineStack>
        <InlineGrid columns={{ xs: 2, md: 5 }} gap="400">
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

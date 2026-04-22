"use client";

import { useTranslations } from "next-intl";
import {
  BlockStack,
  Card,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

const CHART_COLORS = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
];

function DonutChart({
  segments,
  total,
}: {
  segments: { value: number; color: string }[];
  total: number;
}) {
  const size = 140;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let accumulatedOffset = 0;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--p-color-border-secondary)"
          strokeWidth={strokeWidth}
        />
        {segments.map((seg, i) => {
          const pct = seg.value / 100;
          const dashLength = pct * circumference;
          const dashGap = circumference - dashLength;
          const offset = -accumulatedOffset + circumference * 0.25;
          accumulatedOffset += dashLength;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${dashGap}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              style={{ transition: "stroke-dasharray 0.3s ease" }}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: size,
          height: size,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text as="p" variant="headingLg">
          {total}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          Total
        </Text>
      </div>
    </div>
  );
}

export function DashboardCategories({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const tPacks = useTranslations("packs");

  const translateCategory = (label: string) => {
    try {
      return tPacks(`disputeTypeLabel.${label}`);
    } catch {
      return label
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };

  if (loading) return null;
  if (stats.disputeCategories.length === 0) return null;

  const total = stats.disputeCategories.reduce((s, c) => s + c.count, 0);

  const segments = stats.disputeCategories.map((cat, i) => ({
    value: cat.value,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("disputeCategories")}
          </Text>
        </InlineStack>
        <InlineGrid columns={{ xs: 1, md: "auto 1fr" }} gap="600" alignItems="center">
          <DonutChart segments={segments} total={total} />
          <BlockStack gap="300">
            {stats.disputeCategories.map((cat, i) => (
              <InlineStack key={cat.label} gap="200" blockAlign="center" wrap={false}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: CHART_COLORS[i % CHART_COLORS.length],
                    flexShrink: 0,
                  }}
                />
                <Text as="span" variant="bodySm">
                  {translateCategory(cat.label)}
                </Text>
                <div style={{ marginLeft: "auto", flexShrink: 0 }}>
                  <InlineStack gap="100">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {cat.count}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      ({cat.value}%)
                    </Text>
                  </InlineStack>
                </div>
              </InlineStack>
            ))}
          </BlockStack>
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}

/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/analytics/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-analytics.tsx
 * Reference: analytics overview — period selector, 4 KPI cards, win rate trend,
 * disputes by reason breakdown (progress bars).
 */
"use client";

import { Suspense, useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  ButtonGroup,
  Button,
  Spinner,
  ProgressBar,
  Badge,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";

type PeriodKey = "24h" | "7d" | "30d" | "all";

interface AnalyticsData {
  totalDisputes: number;
  winRate: number;
  revenueRecovered: string;
  avgResponseTime: string;
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
}

const DEFAULT_DATA: AnalyticsData = {
  totalDisputes: 0,
  winRate: 0,
  revenueRecovered: "$0",
  avgResponseTime: "—",
  winRateTrend: [0, 0, 0, 0, 0, 0],
  disputeCategories: [],
};

function AnalyticsContent({
  period,
  onPeriodChange,
}: {
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
}) {
  const t = useTranslations("analytics");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard/stats?period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => { if (!cancelled && d) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const d = data ?? DEFAULT_DATA;

  return (
    <>
      {/* Period selector + KPI cards */}
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="h2" variant="headingMd">{t("overview")}</Text>
              <ButtonGroup>
                {(["24h", "7d", "30d", "all"] as const).map((key) => (
                  <Button
                    key={key}
                    variant={period === key ? "primary" : "plain"}
                    size="slim"
                    onClick={() => onPeriodChange(key)}
                  >
                    {t(`period${key === "all" ? "All" : key}`)}
                  </Button>
                ))}
              </ButtonGroup>
            </InlineStack>

            {loading ? (
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="small" />
              </BlockStack>
            ) : (
              <InlineStack gap="400" wrap>
                <Box minWidth="140px">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{t("totalDisputes")}</Text>
                    <Text as="p" variant="headingXl">{d.totalDisputes}</Text>
                  </BlockStack>
                </Box>
                <Box minWidth="140px">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{t("winRate")}</Text>
                    <Text as="p" variant="headingXl">{d.winRate}%</Text>
                  </BlockStack>
                </Box>
                <Box minWidth="140px">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{t("revenueRecovered")}</Text>
                    <Text as="p" variant="headingXl">{d.revenueRecovered}</Text>
                  </BlockStack>
                </Box>
                <Box minWidth="140px">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">{t("avgResponseTime")}</Text>
                    <Text as="p" variant="headingXl">{d.avgResponseTime}</Text>
                  </BlockStack>
                </Box>
              </InlineStack>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* Win Rate Trend */}
      <Layout.Section variant="oneHalf">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("winRateTrend")}</Text>
            {loading ? (
              <Spinner size="small" />
            ) : d.winRateTrend.every((v) => v === 0) ? (
              <Text as="p" variant="bodySm" tone="subdued">{t("noData")}</Text>
            ) : (
              <BlockStack gap="200">
                {d.winRateTrend.map((pct, i) => (
                  <InlineStack key={i} gap="300" blockAlign="center">
                    <Box minWidth="32px">
                      <Text as="span" variant="bodySm" tone="subdued">W{i + 1}</Text>
                    </Box>
                    <Box minWidth="120px">
                      <ProgressBar progress={pct} size="small" />
                    </Box>
                    <Text as="span" variant="bodySm">{pct}%</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>

      {/* Disputes by Reason */}
      <Layout.Section variant="oneHalf">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("byReason")}</Text>
            {loading ? (
              <Spinner size="small" />
            ) : d.disputeCategories.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">{t("noData")}</Text>
            ) : (
              <BlockStack gap="300">
                {d.disputeCategories.map(({ label, value }) => (
                  <BlockStack key={label} gap="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">{label}</Text>
                      <Badge>{`${value}%`}</Badge>
                    </InlineStack>
                    <ProgressBar progress={value} size="small" />
                  </BlockStack>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
    </>
  );
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const [period, setPeriod] = useState<PeriodKey>("30d");

  return (
    <Page
      title={t("title")}
      subtitle={t("subtitle")}
    >
      <Layout>
        <Suspense
          fallback={
            <Layout.Section>
              <Card>
                <BlockStack gap="400" inlineAlign="center">
                  <Spinner />
                </BlockStack>
              </Card>
            </Layout.Section>
          }
        >
          <AnalyticsContent period={period} onPeriodChange={setPeriod} />
        </Suspense>
      </Layout>
    </Page>
  );
}

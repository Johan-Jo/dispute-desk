"use client";

/**
 * Chargeback Exposure (embedded Insights page).
 *
 * One calendar month at a time, from the stored month record
 * (docs/plans/insights-single-source.plan.md PR3b). The layout is
 * transcribed from the Claude Design file "Chargeback Exposure Alternatives"
 * (variant 1a, Trend hero); see ExposureView.tsx.
 *
 * Removed with the redesign (2026-10-02): the Shopify risk-classification
 * hero and breakdown, the risk-vs-outcome chart, the chargeback-health gauge
 * and weekly sparkline, and the separate Liability-shift card — each showed
 * its own VAMP-like number; the page now shows exactly one per month.
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Page, Layout, Card, BlockStack, Text, Banner, Spinner } from "@shopify/polaris";

import type { InsightsPeriod } from "@/lib/insights/period/readInsightsPeriod";
import type { TrendPoint } from "@/lib/insights/period/readTrend";
import type { LiveState } from "@/lib/insights/period/computeLiveState";
import type { PreviousReasons } from "@/lib/insights/period/reasonComparison";
import { formatMonth } from "@/lib/insights/period/format";
import { ExposureView } from "./ExposureView";

interface InsightsResponse {
  historicalImportStatus: "not_started" | "in_progress" | "complete" | "failed";
  historicalImportOrdersTotal: number;
  period: InsightsPeriod;
  trend: TrendPoint[];
  liveState: LiveState | null;
  previousReasons: PreviousReasons | null;
}

export default function InitialAnalysisPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  /** "" = the statement month (server default); "YYYY-MM-01" or "mtd". */
  const [selected, setSelected] = useState("");

  const load = useCallback((value: string) => {
    let cancelled = false;
    setLoading(true);
    // `view=period`: only what this page renders (the full response also
    // carries the dashboard's 90-day blocks, which take 10–20 s to build).
    const q = value === "" ? "" : `&period=${value === "mtd" ? "mtd" : value.slice(0, 7)}`;
    fetch(`/api/dashboard/insights/initial-analysis?view=period${q}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(""), [load]);

  const title = t("fraudIntel.pageTitleV2");

  if (loading && !data) {
    return (
      <Page title={title}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Spinner size="small" />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title={title}>
        <Layout>
          <Layout.Section>
            <Banner tone="warning" title={t("fraudIntel.failedTitle")}>
              <p>{t("fraudIntel.failedBody")}</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (data.historicalImportStatus !== "complete") {
    return (
      <Page title={title}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  {t("fraudIntel.analyzingTitle")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("fraudIntel.analyzingBody", {
                    count: data.historicalImportOrdersTotal.toLocaleString(),
                  })}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Selector: the trend window's months, newest first, then month-to-date.
  const monthOptions = [
    { value: "mtd", label: t("insightsPage.monthOptionMtd" as never) },
    ...[...data.trend].reverse().map((x) => ({ value: x.periodMonth, label: formatMonth(x.periodMonth, locale) })),
  ];
  const current = selected === "" ? data.period.periodMonth : selected;
  if (!monthOptions.some((o) => o.value === current)) {
    monthOptions.push({ value: current, label: formatMonth(data.period.periodMonth, locale) });
  }

  return (
    <Page title={title}>
      <ExposureView
        period={data.period}
        trend={data.trend}
        previousReasons={data.previousReasons ?? null}
        monthOptions={monthOptions}
        selected={current}
        onSelect={(value) => {
          setSelected(value);
          load(value);
        }}
      />
    </Page>
  );
}

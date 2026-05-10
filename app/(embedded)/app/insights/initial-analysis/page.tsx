"use client";

/**
 * Phase 1 Shopify Fraud Intelligence — Initial Analysis page.
 *
 * Permanent home for the onboarding insight content. The dashboard
 * banner is dismissible; this page is always reachable from the
 * banner CTAs (and via future navigation entries).
 *
 * Layout follows the same insight-first hierarchy as the banner:
 *   1. Headline (orders analyzed) leads.
 *   2. Recent-window percentages give the merchant context.
 *   3. Risk breakdown table.
 *   4. Chargeback Health section (anchor #chargeback-health).
 *   5. What this means / what to do next.
 *
 * Positioning: chargeback operations + merchant intelligence.
 * Never frame as fraud prevention.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Spinner,
  Badge,
  Divider,
  Banner,
} from "@shopify/polaris";

interface InsightsResponse {
  available: boolean;
  ordersAnalyzed: number;
  windowStart90d: string;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  acceptanceRatePct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  chargebackRate90d: number | null;
  chargebackHealth: "good" | "at_risk" | "elevated" | "unknown";
  riskBreakdown: {
    low: number;
    medium: number;
    high: number;
    none: number;
    pending: number;
  };
  historicalImportStatus:
    | "not_started"
    | "in_progress"
    | "complete"
    | "failed";
  historicalImportOrdersTotal: number;
  historicalImportSinceDate: string | null;
  historicalImportScopeGranted: "default_window" | "read_all_orders" | null;
  historicalImportCompletedAt: string | null;
}

function formatPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function HealthBadge({
  status,
  rateLabel,
  label,
}: {
  status: InsightsResponse["chargebackHealth"];
  rateLabel: string;
  label: string;
}) {
  const tone =
    status === "good"
      ? "success"
      : status === "at_risk"
        ? "attention"
        : status === "elevated"
          ? "critical"
          : undefined;
  return (
    <InlineStack gap="200" blockAlign="center">
      <Text as="span" variant="bodyMd">
        {rateLabel}
      </Text>
      <Badge tone={tone}>{label}</Badge>
    </InlineStack>
  );
}

export default function InitialAnalysisPage() {
  const t = useTranslations();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/insights/initial-analysis")
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

  if (loading) {
    return (
      <Page title={t("fraudIntel.pageTitle")}>
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
      <Page title={t("fraudIntel.pageTitle")}>
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
      <Page title={t("fraudIntel.pageTitle")}>
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

  const { riskBreakdown } = data;
  const riskTotal =
    riskBreakdown.low +
    riskBreakdown.medium +
    riskBreakdown.high +
    riskBreakdown.none +
    riskBreakdown.pending;

  return (
    <Page
      title={t("fraudIntel.pageTitle")}
      subtitle={t("fraudIntel.pageSubtitle")}
    >
      <Layout>
        {/* ── Hero: insight leads, not verdict ─────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingLg">
                {t("fraudIntel.pageHeadline", {
                  count: data.ordersAnalyzed.toLocaleString(),
                })}
              </Text>
              <Text as="p">
                {t("fraudIntel.pageBody", {
                  high: data.highRiskPct?.toFixed(1) ?? "—",
                  fulfilled: data.fulfilledHighRiskPct?.toFixed(0) ?? "—",
                })}
              </Text>
              {data.historicalImportScopeGranted === "default_window" ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("fraudIntel.pageScopeNoteDefault")}
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Window summary ───────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("fraudIntel.pageSection90d")}
              </Text>
              <InlineStack gap="600" wrap>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("fraudIntel.kpiAcceptanceRate")}
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatPct(data.acceptanceRatePct)}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("fraudIntel.kpiHighRiskRate")}
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatPct(data.highRiskPct)}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("fraudIntel.kpiFraudDisputeRate")}
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatPct(data.fraudDisputeRatePct)}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("fraudIntel.kpiHighRiskFulfilled")}
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatPct(data.fulfilledHighRiskPct)}
                  </Text>
                </BlockStack>
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("fraudIntel.kpiProtectCoverage")}
                  </Text>
                  <Text as="p" variant="headingMd">
                    {formatPct(data.shopifyProtectCoveragePct)}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("fraudIntel.tooltipAcceptanceRate")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Risk breakdown table ─────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("fraudIntel.riskBreakdownTitle")}
              </Text>
              <RiskRow
                label={t("fraudIntel.riskHigh")}
                count={riskBreakdown.high}
                total={riskTotal}
                color="#DC2626"
              />
              <RiskRow
                label={t("fraudIntel.riskMedium")}
                count={riskBreakdown.medium}
                total={riskTotal}
                color="#F59E0B"
              />
              <RiskRow
                label={t("fraudIntel.riskLow")}
                count={riskBreakdown.low}
                total={riskTotal}
                color="#10B981"
              />
              <RiskRow
                label={t("fraudIntel.riskPending")}
                count={riskBreakdown.pending}
                total={riskTotal}
                color="#6B7280"
              />
              <RiskRow
                label={t("fraudIntel.riskNone")}
                count={riskBreakdown.none}
                total={riskTotal}
                color="#9CA3AF"
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Chargeback Health section (banner CTA target) ────────── */}
        <Layout.Section>
          <Card>
            <div id="chargeback-health">
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  {t("fraudIntel.chargebackHealthTitle")}
                </Text>
                <HealthBadge
                  status={data.chargebackHealth}
                  rateLabel={
                    data.chargebackRate90d === null
                      ? t("fraudIntel.kpiUnavailable")
                      : `${data.chargebackRate90d.toFixed(2)}%`
                  }
                  label={t(
                    `fraudIntel.bannerHealth_${data.chargebackHealth}`,
                  )}
                />
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("fraudIntel.chargebackHealthExplain")}
                </Text>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("fraudIntel.chargebackHealthBands")}
                </Text>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* ── What this means / what to do next ────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("fraudIntel.whatThisMeansTitle")}
              </Text>
              <Text as="p">{t("fraudIntel.whatThisMeansBody")}</Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function RiskRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: color,
          flexShrink: 0,
        }}
      />
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
      <div style={{ flex: 1 }} />
      <Text as="span" variant="bodyMd" tone="subdued">
        {count.toLocaleString()} ({pct}%)
      </Text>
    </InlineStack>
  );
}

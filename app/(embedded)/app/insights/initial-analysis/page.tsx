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
  chargebackHealthAvailable: boolean;
  chargebackOrders90d: number;
  riskToDisputeConversion?: {
    high: RiskConversionBucket;
    medium: RiskConversionBucket;
    low: RiskConversionBucket;
    none: RiskConversionBucket;
    pending: RiskConversionBucket;
  };
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

interface RiskConversionBucket {
  orders: number;
  disputes: number;
  conversionPct: number | null;
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

        {/* ── Risk breakdown table + "what these mean" explainer ─────
            "Cleared" is the largest bucket on most healthy stores and
            its difference from "Low" is genuinely non-obvious — both
            look like "safe orders" but Shopify treats them differently
            (Low = positive signals; Cleared = no signals either way).
            The info banner at the top addresses that confusion head-on
            before the operator scans the table; the per-bucket
            definitions below repeat the distinction in the row text. */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                {t("fraudIntel.riskBreakdownTitle")}
              </Text>
              <Banner tone="info" title={t("fraudIntel.breakdownExplainBannerTitle")}>
                <p>{t("fraudIntel.breakdownExplainBannerBody")}</p>
              </Banner>
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

              <Divider />

              <BlockStack gap="150">
                <Text as="h4" variant="headingSm">
                  {t("fraudIntel.breakdownExplainTitle")}
                </Text>
                <BreakdownExplainRow
                  label={t("fraudIntel.riskHigh")}
                  body={t("fraudIntel.breakdownExplainHigh")}
                  color="#DC2626"
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskMedium")}
                  body={t("fraudIntel.breakdownExplainMedium")}
                  color="#F59E0B"
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskLow")}
                  body={t("fraudIntel.breakdownExplainLow")}
                  color="#10B981"
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskPending")}
                  body={t("fraudIntel.breakdownExplainPending")}
                  color="#6B7280"
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskNone")}
                  body={t("fraudIntel.breakdownExplainCleared")}
                  color="#9CA3AF"
                  emphasize
                />
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Risk-to-dispute correlation ─────────────────────────────
            Observational: shows what % of orders in each Shopify risk
            bucket actually became disputes. Answers "how predictive
            was Shopify's classification for THIS merchant?" without
            making a verdict. Per-bucket gating on sample size so a
            tiny denominator never produces a misleading rate. */}
        {data.riskToDisputeConversion ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">
                    {t("fraudIntel.correlationTitle")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("fraudIntel.correlationSubtitle")}
                  </Text>
                </BlockStack>
                <ConversionRow
                  label={t("fraudIntel.riskHigh")}
                  color="#DC2626"
                  bucket={data.riskToDisputeConversion.high}
                  insufficientLabel={t("fraudIntel.correlationInsufficient")}
                />
                <ConversionRow
                  label={t("fraudIntel.riskMedium")}
                  color="#F59E0B"
                  bucket={data.riskToDisputeConversion.medium}
                  insufficientLabel={t("fraudIntel.correlationInsufficient")}
                />
                <ConversionRow
                  label={t("fraudIntel.riskLow")}
                  color="#10B981"
                  bucket={data.riskToDisputeConversion.low}
                  insufficientLabel={t("fraudIntel.correlationInsufficient")}
                />
                <ConversionRow
                  label={t("fraudIntel.riskNone")}
                  color="#9CA3AF"
                  bucket={data.riskToDisputeConversion.none}
                  insufficientLabel={t("fraudIntel.correlationInsufficient")}
                />
                <Divider />
                <CorrelationObservation
                  conversion={data.riskToDisputeConversion}
                  t={t}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        {/* ── Chargeback Health section (banner CTA target) ──────────
            Verdict only renders when the 90-day order denominator is
            statistically meaningful. Below the threshold we show
            "Insufficient dispute history" — observational, no implied
            judgement on the merchant. */}
        <Layout.Section>
          <Card>
            <div id="chargeback-health">
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  {t("fraudIntel.chargebackHealthTitle")}
                </Text>
                {data.chargebackHealthAvailable ? (
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
                ) : (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      {t("fraudIntel.chargebackHealthInsufficientTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("fraudIntel.chargebackHealthInsufficientBody", {
                        count: data.chargebackOrders90d.toLocaleString(),
                      })}
                    </Text>
                  </BlockStack>
                )}
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

/** One row in the risk-to-dispute correlation table. Shows the
 *  bucket name, dot color, raw "X of Y disputed" counts, and the
 *  conversion percentage when the sample is large enough. Below the
 *  per-bucket sample threshold, the pct slot reads "insufficient
 *  sample" — observational, no implied judgement.
 */
function ConversionRow({
  label,
  color,
  bucket,
  insufficientLabel,
}: {
  label: string;
  color: string;
  bucket: RiskConversionBucket;
  insufficientLabel: string;
}) {
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
        {bucket.disputes.toLocaleString()} of {bucket.orders.toLocaleString()}
      </Text>
      <Text
        as="span"
        variant="bodyMd"
        fontWeight={bucket.conversionPct === null ? "regular" : "semibold"}
        tone={bucket.conversionPct === null ? "subdued" : undefined}
      >
        {bucket.conversionPct === null
          ? insufficientLabel
          : `${bucket.conversionPct.toFixed(1)}%`}
      </Text>
    </InlineStack>
  );
}

/** Footer observation on the correlation table. Compares the HIGH
 *  bucket's conversion rate to the LOW + NONE blended baseline (the
 *  "safe orders" pool). Only renders an observation when both sides
 *  have meaningful samples AND a meaningful ratio. Otherwise stays
 *  silent rather than fabricating a takeaway.
 */
function CorrelationObservation({
  conversion,
  t,
}: {
  conversion: NonNullable<InsightsResponse["riskToDisputeConversion"]>;
  t: ReturnType<typeof useTranslations>;
}) {
  const high = conversion.high;
  const low = conversion.low;
  const none = conversion.none;

  if (high.conversionPct === null) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {t("fraudIntel.correlationObservationNeedHigh")}
      </Text>
    );
  }

  // Blend LOW + NONE as the "safe orders" baseline. Each must
  // individually have a meaningful sample for the blend to be honest.
  const safeOrders = low.orders + none.orders;
  const safeDisputes = low.disputes + none.disputes;
  const safeBlendPct = safeOrders > 0 ? (safeDisputes / safeOrders) * 100 : null;
  if (safeBlendPct === null || (low.conversionPct === null && none.conversionPct === null)) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {t("fraudIntel.correlationObservationNeedSafe")}
      </Text>
    );
  }

  const ratio = safeBlendPct > 0 ? high.conversionPct / safeBlendPct : null;
  if (ratio === null) {
    return null;
  }

  if (ratio >= 2.0) {
    return (
      <Text as="p" variant="bodyMd">
        {t("fraudIntel.correlationObservationStrong", {
          ratio: ratio.toFixed(1),
        })}
      </Text>
    );
  }
  if (ratio >= 1.3) {
    return (
      <Text as="p" variant="bodyMd">
        {t("fraudIntel.correlationObservationMild", {
          ratio: ratio.toFixed(1),
        })}
      </Text>
    );
  }
  if (ratio < 0.8) {
    return (
      <Text as="p" variant="bodyMd">
        {t("fraudIntel.correlationObservationInverted")}
      </Text>
    );
  }
  return (
    <Text as="p" variant="bodySm" tone="subdued">
      {t("fraudIntel.correlationObservationFlat")}
    </Text>
  );
}

/** Single explanation row for the "What these mean" block below the
 *  breakdown table. Mirrors the dot-color of the matching RiskRow so
 *  the eye traces table → definition without re-reading the label.
 *  `emphasize` is used on the Cleared row — it's the largest bucket
 *  and the most easily misread, so it gets normal body text instead
 *  of subdued.
 */
function BreakdownExplainRow({
  label,
  body,
  color,
  emphasize = false,
}: {
  label: string;
  body: string;
  color: string;
  emphasize?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: color,
          flexShrink: 0,
          marginTop: 7,
        }}
      />
      <Text as="p" variant="bodySm" tone={emphasize ? undefined : "subdued"}>
        <strong>{label}</strong> — {body}
      </Text>
    </div>
  );
}

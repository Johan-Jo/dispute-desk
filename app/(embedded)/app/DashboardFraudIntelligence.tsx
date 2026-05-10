"use client";

/**
 * Phase 1 Shopify Fraud Intelligence — embedded dashboard panel.
 *
 * Single Polaris Card with:
 *   - Title row: heading + window selector (30/90/365/all)
 *   - KPI grid: acceptance rate, high-risk order rate, fraud dispute rate,
 *     high-risk fulfillment rate, Shopify Protect coverage, orders analyzed.
 *
 * State machine (driven by `historical_import_status` on the shops row):
 *   - not_started / in_progress  → progress card; KPIs hidden until backfill completes.
 *   - failed                     → snag-state card with retry guidance.
 *   - complete                   → full KPI panel.
 *
 * Positioning copy throughout this file: chargeback operations +
 * merchant intelligence. Never frame as fraud prevention.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Select,
  Tooltip,
  Icon,
  ProgressBar,
  Banner,
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";

type WindowKey = "30d" | "90d" | "365d" | "all";

interface KpiValue {
  rate: number | null;
  available: boolean;
  numerator: number;
  denominator: number;
}

interface FraudMetricsResponse {
  window: WindowKey;
  windowStart: string | null;
  ordersAnalyzed: number;
  acceptanceRate: KpiValue;
  highRiskRate: KpiValue;
  fraudDisputeRate: KpiValue;
  highRiskFulfillmentRate: KpiValue;
  shopifyProtectCoverage: KpiValue;
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
  historicalImportOrdersProcessed: number;
  historicalImportSinceDate: string | null;
  historicalImportScopeGranted: "default_window" | "read_all_orders" | null;
  lastSyncedAt: string | null;
}

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}%`;
}

function KpiTile({
  label,
  tooltip,
  value,
  subtext,
}: {
  label: string;
  tooltip: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div
      style={{
        padding: "16px",
        border: "1px solid #E1E3E5",
        borderRadius: "10px",
        background: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Tooltip content={tooltip}>
          <span style={{ display: "inline-flex" }}>
            <Icon source={InfoIcon} tone="subdued" />
          </span>
        </Tooltip>
      </InlineStack>
      <Text as="p" variant="headingLg" fontWeight="bold">
        {value}
      </Text>
      {subtext ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {subtext}
        </Text>
      ) : null}
    </div>
  );
}

export function DashboardFraudIntelligence() {
  const t = useTranslations();
  const [window, setWindow] = useState<WindowKey>("90d");
  const [data, setData] = useState<FraudMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard/fraud-metrics?window=${window}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [window]);

  // ── In-progress / not-started state ──────────────────────────────
  // Gate before showing KPIs: we never display partial numbers
  // during backfill. Differentiates two states:
  //  - not_started: backfill hasn't been claimed yet. The dashboard
  //    API self-heals by enqueueing on read; the worker cron picks
  //    it up within ~2 min. Use queued copy (no "0 orders processed").
  //  - in_progress: worker is actively processing; surface the moving
  //    order count so merchants see work happening.
  if (data && data.historicalImportStatus === "not_started") {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("fraudIntel.queuedTitle")}
          </Text>
          <Text as="p" tone="subdued">
            {t("fraudIntel.queuedBody")}
          </Text>
        </BlockStack>
      </Card>
    );
  }
  if (data && data.historicalImportStatus === "in_progress") {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("fraudIntel.analyzingTitle")}
          </Text>
          <Text as="p" tone="subdued">
            {t("fraudIntel.analyzingBody", {
              count: data.historicalImportOrdersProcessed.toLocaleString(),
            })}
          </Text>
          <ProgressBar progress={50} size="small" />
        </BlockStack>
      </Card>
    );
  }

  // ── Failure state ────────────────────────────────────────────────
  if (data && data.historicalImportStatus === "failed") {
    return (
      <Card>
        <Banner tone="warning" title={t("fraudIntel.failedTitle")}>
          <p>{t("fraudIntel.failedBody")}</p>
        </Banner>
      </Card>
    );
  }

  // ── Loading skeleton ─────────────────────────────────────────────
  if (loading || !data) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            {t("fraudIntel.title")}
          </Text>
          <div
            style={{
              height: 100,
              borderRadius: 8,
              background: "linear-gradient(90deg,#F4F6F8,#E1E3E5,#F4F6F8)",
              backgroundSize: "200% 100%",
              animation: "fraudIntelShimmer 1.4s linear infinite",
            }}
          />
          <style>{`@keyframes fraudIntelShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        </BlockStack>
      </Card>
    );
  }

  // ── Complete state: KPI panel ────────────────────────────────────
  const windowOptions: Array<{ label: string; value: WindowKey }> = [
    { label: t("fraudIntel.window30"), value: "30d" },
    { label: t("fraudIntel.window90"), value: "90d" },
    { label: t("fraudIntel.window365"), value: "365d" },
    { label: t("fraudIntel.windowAll"), value: "all" },
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              {t("fraudIntel.title")}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {t("fraudIntel.subtitle")}
            </Text>
          </BlockStack>
          <div style={{ minWidth: 160 }}>
            <Select
              label=""
              labelHidden
              options={windowOptions}
              value={window}
              onChange={(v) => setWindow(v as WindowKey)}
            />
          </div>
        </InlineStack>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <KpiTile
            label={t("fraudIntel.kpiAcceptanceRate")}
            tooltip={t("fraudIntel.tooltipAcceptanceRate")}
            value={formatPct(data.acceptanceRate.rate)}
            subtext={
              data.acceptanceRate.available
                ? t("fraudIntel.kpiSubtextFraction", {
                    num: data.acceptanceRate.numerator.toLocaleString(),
                    den: data.acceptanceRate.denominator.toLocaleString(),
                  })
                : t("fraudIntel.kpiUnavailable")
            }
          />
          <KpiTile
            label={t("fraudIntel.kpiHighRiskRate")}
            tooltip={t("fraudIntel.tooltipHighRiskRate")}
            value={formatPct(data.highRiskRate.rate)}
            subtext={
              data.highRiskRate.available
                ? t("fraudIntel.kpiSubtextOf", {
                    num: data.highRiskRate.numerator.toLocaleString(),
                    total: data.ordersAnalyzed.toLocaleString(),
                  })
                : t("fraudIntel.kpiUnavailable")
            }
          />
          <KpiTile
            label={t("fraudIntel.kpiFraudDisputeRate")}
            tooltip={t("fraudIntel.tooltipFraudDisputeRate")}
            value={formatPct(data.fraudDisputeRate.rate)}
            subtext={
              data.fraudDisputeRate.available
                ? t("fraudIntel.kpiSubtextOf", {
                    num: data.fraudDisputeRate.numerator.toLocaleString(),
                    total: data.ordersAnalyzed.toLocaleString(),
                  })
                : t("fraudIntel.kpiUnavailable")
            }
          />
          <KpiTile
            label={t("fraudIntel.kpiHighRiskFulfilled")}
            tooltip={t("fraudIntel.tooltipHighRiskFulfilled")}
            value={formatPct(data.highRiskFulfillmentRate.rate)}
            subtext={
              data.highRiskFulfillmentRate.available
                ? t("fraudIntel.kpiSubtextFraction", {
                    num: data.highRiskFulfillmentRate.numerator.toLocaleString(),
                    den: data.highRiskFulfillmentRate.denominator.toLocaleString(),
                  })
                : t("fraudIntel.kpiUnavailable")
            }
          />
          <KpiTile
            label={t("fraudIntel.kpiProtectCoverage")}
            tooltip={t("fraudIntel.tooltipProtectCoverage")}
            value={formatPct(data.shopifyProtectCoverage.rate)}
            subtext={
              data.shopifyProtectCoverage.available
                ? t("fraudIntel.kpiProtectSubtext")
                : t("fraudIntel.kpiUnavailable")
            }
          />
          <KpiTile
            label={t("fraudIntel.kpiOrdersAnalyzed")}
            tooltip={t("fraudIntel.tooltipOrdersAnalyzed")}
            value={data.ordersAnalyzed.toLocaleString()}
            subtext={t("fraudIntel.kpiOrdersSubtext", {
              window: t(`fraudIntel.window${windowKeyLabel(window)}`),
            })}
          />
        </div>
      </BlockStack>
    </Card>
  );
}

function windowKeyLabel(w: WindowKey): "30" | "90" | "365" | "All" {
  if (w === "30d") return "30";
  if (w === "90d") return "90";
  if (w === "365d") return "365";
  return "All";
}

"use client";

/**
 * Risk Intelligence page — formerly "Initial Analysis".
 *
 * Designed to be useful at install (first impression) AND ongoing
 * (the page merchants return to monthly to check what changed).
 * Each KPI carries a month-over-month delta (current 30d vs prior
 * 30d). Chargeback rate also includes an 8-week sparkline.
 *
 * Layout hierarchy:
 *   1. Hero card — large headline with N orders analyzed + leading
 *      observation copy. Stacked-bar mini-anchor of risk distribution.
 *   2. KPI strip — 5 stat tiles (current value + MoM delta).
 *   3. Risk classification breakdown — full-width stacked bar +
 *      per-row breakdown rows with progress bars + "Cleared vs Low"
 *      info banner + per-bucket definitions.
 *   4. Two-column row:
 *      a. Risk-to-dispute correlation — horizontal bar chart of
 *         conversion rates by risk bucket + observation footer.
 *      b. Chargeback health — gauge with three colored bands +
 *         8-week sparkline trend.
 *   5. "What this means" footer — observational closing note.
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
  Divider,
  Banner,
} from "@shopify/polaris";
import styles from "./initial-analysis.module.css";

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

  windowStart30d: string;
  windowStart30dPrior: string;
  current30d: PeriodWindow;
  prior30d: PeriodWindow;
  chargebackRateSparklineWeekly: Array<{
    weekStart: string;
    rate: number | null;
    orderCount: number;
  }>;

  riskBreakdown: { low: number; medium: number; high: number; none: number; pending: number };
  riskToDisputeConversion?: {
    high: RiskConversionBucket;
    medium: RiskConversionBucket;
    low: RiskConversionBucket;
    none: RiskConversionBucket;
    pending: RiskConversionBucket;
  };

  historicalImportStatus: "not_started" | "in_progress" | "complete" | "failed";
  historicalImportOrdersTotal: number;
  historicalImportSinceDate: string | null;
  historicalImportScopeGranted: "default_window" | "read_all_orders" | null;
  historicalImportCompletedAt: string | null;
}

interface PeriodWindow {
  ordersTotal: number;
  acceptanceRatePct: number | null;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  chargebackRatePct: number | null;
  chargebackOrders: number;
  threeDsAuthRatePct: number | null;
  threeDsAuthOrders: number;
  threeDsAuthEligibleOrders: number;
  medianFulfillmentHours: number | null;
  fulfilledOrdersCount: number;
}

interface RiskConversionBucket {
  orders: number;
  disputes: number;
  conversionPct: number | null;
}

// ═══ Color palette (kept in sync with initial-analysis.module.css) ═══
const RISK_COLOR = {
  HIGH: "#DC2626",
  MEDIUM: "#F59E0B",
  LOW: "#10B981",
  PENDING: "#6B7280",
  NONE: "#9CA3AF",
} as const;

function formatPct(v: number | null, digits = 1): string {
  return v === null ? "—" : `${v.toFixed(digits)}%`;
}

// ═══ DeltaPill: month-over-month change indicator ═══════════════════
/** Renders a small pill showing the delta between current and prior
 *  windows. Color-coded by whether the change is favorable. For some
 *  metrics (chargeback rate, fraud-dispute rate, high-risk rate)
 *  an INCREASE is bad; for others (acceptance rate, Protect coverage)
 *  an increase is good. `inverse=true` flips the color logic. */
function DeltaPill({
  current,
  prior,
  inverse = false,
  unit = "pp",
  t,
}: {
  current: number | null;
  prior: number | null;
  inverse?: boolean;
  /** Unit suffix on the delta — "pp" (percentage points) for rate
   *  metrics, "h" for time-in-hours, custom for anything else. */
  unit?: "pp" | "h";
  t: ReturnType<typeof useTranslations>;
}) {
  if (current === null || prior === null) {
    return (
      <span style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic" }}>
        {t("fraudIntel.deltaNoComparison")}
      </span>
    );
  }
  const delta = current - prior;
  const absDelta = Math.abs(delta);
  // Flat threshold differs by unit. <0.1pp / <0.5h is considered
  // statistically uninteresting.
  const flatCutoff = unit === "h" ? 0.5 : 0.1;
  if (absDelta < flatCutoff) {
    return (
      <span style={{ fontSize: 11, color: "#6D7175", fontWeight: 500 }}>
        → {t("fraudIntel.deltaStable")}
      </span>
    );
  }
  const isUp = delta > 0;
  const isBad = inverse ? isUp : !isUp;
  const color = isBad ? "#DC2626" : "#10B981";
  const arrow = isUp ? "↑" : "↓";
  const unitLabel = unit === "h" ? " h" : " pp";
  return (
    <span
      style={{
        fontSize: 11,
        color,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {arrow} {absDelta.toFixed(1)}{unitLabel} {t("fraudIntel.deltaVsLast")}
    </span>
  );
}

// ═══ HeroDisplay: orders analyzed + leading observation ════════════
function HeroDisplay({
  ordersAnalyzed,
  highRiskPct,
  fulfilledHighRiskPct,
  miniBarData,
  miniBarTotal,
  t,
}: {
  ordersAnalyzed: number;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  miniBarData: { color: string; pct: number; label: string }[];
  miniBarTotal: number;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Card>
      <div className={styles.heroCard}>
        <div className={styles.heroAccentBar} />
        <div className={styles.heroLayout}>
          <BlockStack gap="400">
            <div>
              <div className={styles.heroNumber}>
                {ordersAnalyzed.toLocaleString()}
              </div>
              <div className={styles.heroNumberLabel}>
                {t("fraudIntel.heroNumberLabel")}
              </div>
            </div>
            <Text as="p" variant="bodyLg">
              {t("fraudIntel.pageBody", {
                high: highRiskPct?.toFixed(1) ?? "—",
                fulfilled: fulfilledHighRiskPct?.toFixed(0) ?? "—",
              })}
            </Text>
          </BlockStack>
          {miniBarTotal > 0 ? (
            <div className={styles.heroMiniBar}>
              <div className={styles.heroMiniBarLabel}>
                {t("fraudIntel.heroMiniBarLabel")}
              </div>
              <StackedDistributionBar segments={miniBarData} />
              <StackedLegend
                segments={miniBarData}
                total={miniBarTotal}
                compact
              />
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ═══ KpiTile: stat tile with current value + MoM delta ════════════
function KpiTile({
  label,
  value,
  current,
  prior,
  inverseDelta,
  deltaUnit,
  context,
  t,
}: {
  label: string;
  value: string;
  current: number | null;
  prior: number | null;
  inverseDelta?: boolean;
  deltaUnit?: "pp" | "h";
  context?: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className={styles.kpiTile}>
      <div className={styles.kpiTileLabel}>{label}</div>
      <div className={styles.kpiTileValue}>{value}</div>
      <DeltaPill
        current={current}
        prior={prior}
        inverse={inverseDelta}
        unit={deltaUnit}
        t={t}
      />
      {context ? <div className={styles.kpiTileContext}>{context}</div> : null}
    </div>
  );
}

// ═══ StackedDistributionBar: full-width segmented bar ══════════════
function StackedDistributionBar({
  segments,
}: {
  segments: { color: string; pct: number; label: string }[];
}) {
  return (
    <div
      className={styles.stackedBar}
      role="img"
      aria-label={segments
        .map((s) => `${s.label} ${s.pct.toFixed(1)}%`)
        .join(", ")}
    >
      {segments.map((s, i) => (
        <div
          key={i}
          className={styles.stackedSegment}
          style={{
            width: `${s.pct}%`,
            background: s.color,
          }}
          title={`${s.label} — ${s.pct.toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

function StackedLegend({
  segments,
  total,
  compact = false,
}: {
  segments: { color: string; pct: number; label: string; count?: number }[];
  total: number;
  compact?: boolean;
}) {
  return (
    <div className={styles.stackedBarLegend}>
      {segments.map((s, i) => (
        <div key={i} className={styles.stackedBarLegendItem}>
          <span
            className={styles.stackedBarLegendDot}
            style={{ background: s.color }}
          />
          <span>
            <span className={styles.stackedBarLegendStrong}>{s.label}</span>
            {compact ? null : ` · ${s.count?.toLocaleString()}`} ·{" "}
            {s.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══ DistributionRow: dot + label + progress bar + count ═══════════
function DistributionRow({
  label,
  color,
  count,
  total,
}: {
  label: string;
  color: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={styles.distRow}>
      <span className={styles.distRowDot} style={{ background: color }} />
      <span className={styles.distRowLabel}>{label}</span>
      <div className={styles.distRowTrack}>
        <div
          className={styles.distRowFill}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className={styles.distRowMeta}>
        <span className={styles.distRowMetaStrong}>
          {count.toLocaleString()}
        </span>{" "}
        ({pct.toFixed(1)}%)
      </span>
    </div>
  );
}

// ═══ ConversionBarChart: horizontal bars showing per-bucket rate ══
function ConversionBarChart({
  rows,
  insufficientLabel,
}: {
  rows: {
    label: string;
    color: string;
    bucket: RiskConversionBucket;
  }[];
  insufficientLabel: string;
}) {
  // Scale bars to the max conversion rate so relative magnitudes are
  // visible. If every bucket is null (no data), the chart degrades
  // gracefully with empty tracks.
  const maxPct = Math.max(
    ...rows.map((r) => (r.bucket.conversionPct ?? 0)),
    0.01,
  );
  return (
    <div className={styles.convChart}>
      {rows.map((r, i) => {
        const pct = r.bucket.conversionPct;
        const barPct =
          pct === null ? 0 : Math.max((pct / maxPct) * 100, 3);
        return (
          <div key={i} className={styles.convRow}>
            <div className={styles.convRowLabel}>
              <span
                className={styles.convRowLabelDot}
                style={{ background: r.color }}
              />
              {r.label}
            </div>
            <div className={styles.convBar}>
              {pct !== null ? (
                <div
                  className={styles.convBarFill}
                  style={{
                    width: `${barPct}%`,
                    background: r.color,
                  }}
                >
                  {barPct > 14 ? `${pct.toFixed(1)}%` : null}
                </div>
              ) : null}
            </div>
            <div>
              {pct !== null ? (
                <div className={styles.convRowValue}>
                  {pct.toFixed(1)}%
                </div>
              ) : (
                <div
                  className={`${styles.convRowSubtle} ${styles.convRowSubtleInsufficient}`}
                >
                  {insufficientLabel}
                </div>
              )}
              <div className={styles.convRowSubtle}>
                {r.bucket.disputes.toLocaleString()} /{" "}
                {r.bucket.orders.toLocaleString()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ ChargebackGauge: tri-band horizontal gauge with marker ════════
function ChargebackGauge({
  rate,
  status,
  available,
  statusLabel,
  insufficientLabel,
  bandsLabel,
  goodLabel,
  atRiskLabel,
  elevatedLabel,
}: {
  rate: number | null;
  status: InsightsResponse["chargebackHealth"];
  available: boolean;
  statusLabel: string;
  insufficientLabel: string;
  bandsLabel: string;
  goodLabel: string;
  atRiskLabel: string;
  elevatedLabel: string;
}) {
  // Gauge scale: 0% → 1%. Bands at 0.4% (good→at_risk) and 0.6%
  // (at_risk→elevated). A rate above 1% pins to the right edge —
  // realistic worst-case for surfacing on the gauge.
  const SCALE_MAX = 1.0;
  const safeRate = rate === null ? null : Math.min(Math.max(rate, 0), SCALE_MAX);
  const markerPct =
    safeRate === null ? null : (safeRate / SCALE_MAX) * 100;
  const statusClass = available
    ? styles[`gaugeStatus_${status}` as keyof typeof styles]
    : styles.gaugeStatus_unknown;
  return (
    <div className={styles.gaugeWrap}>
      <div className={styles.gaugeRow}>
        <div>
          <div className={styles.gaugeRateValue}>
            {rate === null ? "—" : `${rate.toFixed(2)}%`}
          </div>
          <div className={styles.gaugeRateLabel}>{bandsLabel}</div>
        </div>
        <span className={`${styles.gaugeStatus} ${statusClass}`}>
          {available ? statusLabel : insufficientLabel}
        </span>
      </div>
      <div className={styles.gaugeTrack}>
        {markerPct !== null ? (
          <div
            className={styles.gaugeMarker}
            style={{ left: `${markerPct}%` }}
            aria-hidden
          />
        ) : null}
      </div>
      <div className={styles.gaugeTicks}>
        <span>0%</span>
        <span style={{ marginLeft: "auto", marginRight: "auto" }}>0.5%</span>
        <span>{SCALE_MAX.toFixed(1)}%+</span>
      </div>
      <div className={styles.gaugeBands}>
        <div className={styles.gaugeBandItem}>
          <span
            className={`${styles.gaugeBandDot} ${styles.gaugeBand_good}`}
          />
          {goodLabel}
        </div>
        <div className={styles.gaugeBandItem}>
          <span
            className={`${styles.gaugeBandDot} ${styles.gaugeBand_at_risk}`}
          />
          {atRiskLabel}
        </div>
        <div className={styles.gaugeBandItem}>
          <span
            className={`${styles.gaugeBandDot} ${styles.gaugeBand_elevated}`}
          />
          {elevatedLabel}
        </div>
      </div>
    </div>
  );
}

// ═══ Sparkline: weekly chargeback rate over 8 weeks ════════════════
function Sparkline({
  points,
  height = 40,
  width = 220,
}: {
  points: Array<{ weekStart: string; rate: number | null; orderCount: number }>;
  height?: number;
  width?: number;
}) {
  const numbers = points.map((p) => p.rate).filter((r): r is number => r !== null);
  if (numbers.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic" }}>
        No data
      </div>
    );
  }
  const min = 0;
  const max = Math.max(...numbers, 1.0);
  const padX = 4;
  const padY = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const xStep = points.length > 1 ? w / (points.length - 1) : w;

  const segs: string[] = [];
  let prev: { x: number; y: number } | null = null;
  points.forEach((p, i) => {
    if (p.rate === null) {
      prev = null;
      return;
    }
    const x = padX + i * xStep;
    const y = padY + h - ((p.rate - min) / (max - min)) * h;
    if (prev) segs.push(`M ${prev.x} ${prev.y} L ${x} ${y}`);
    prev = { x, y };
  });

  const lastPoint = points
    .map((p, i) => ({ ...p, i }))
    .reverse()
    .find((p) => p.rate !== null);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Weekly chargeback rate, last 8 weeks"
    >
      <path
        d={segs.join(" ")}
        fill="none"
        stroke="#005BD3"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastPoint && lastPoint.rate !== null ? (
        <circle
          cx={padX + lastPoint.i * xStep}
          cy={padY + h - ((lastPoint.rate - min) / (max - min)) * h}
          r="2.5"
          fill="#005BD3"
        />
      ) : null}
    </svg>
  );
}

// ═══ Main page ═════════════════════════════════════════════════════
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
      <Page title={t("fraudIntel.pageTitleV2")}>
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
      <Page title={t("fraudIntel.pageTitleV2")}>
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
      <Page title={t("fraudIntel.pageTitleV2")}>
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

  const { riskBreakdown, current30d, prior30d } = data;
  const riskTotal =
    riskBreakdown.low +
    riskBreakdown.medium +
    riskBreakdown.high +
    riskBreakdown.none +
    riskBreakdown.pending;

  // Stacked-bar segments — ordered by severity for visual rhythm.
  const distSegments = [
    {
      color: RISK_COLOR.HIGH,
      pct: riskTotal > 0 ? (riskBreakdown.high / riskTotal) * 100 : 0,
      count: riskBreakdown.high,
      label: t("fraudIntel.riskHigh"),
    },
    {
      color: RISK_COLOR.MEDIUM,
      pct: riskTotal > 0 ? (riskBreakdown.medium / riskTotal) * 100 : 0,
      count: riskBreakdown.medium,
      label: t("fraudIntel.riskMedium"),
    },
    {
      color: RISK_COLOR.LOW,
      pct: riskTotal > 0 ? (riskBreakdown.low / riskTotal) * 100 : 0,
      count: riskBreakdown.low,
      label: t("fraudIntel.riskLow"),
    },
    {
      color: RISK_COLOR.PENDING,
      pct: riskTotal > 0 ? (riskBreakdown.pending / riskTotal) * 100 : 0,
      count: riskBreakdown.pending,
      label: t("fraudIntel.riskPending"),
    },
    {
      color: RISK_COLOR.NONE,
      pct: riskTotal > 0 ? (riskBreakdown.none / riskTotal) * 100 : 0,
      count: riskBreakdown.none,
      label: t("fraudIntel.riskNone"),
    },
  ];

  return (
    <Page
      title={t("fraudIntel.pageTitleV2")}
      subtitle={t("fraudIntel.pageSubtitle")}
    >
      <Layout>
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <Layout.Section>
          <HeroDisplay
            ordersAnalyzed={data.ordersAnalyzed}
            highRiskPct={data.highRiskPct}
            fulfilledHighRiskPct={data.fulfilledHighRiskPct}
            miniBarData={distSegments}
            miniBarTotal={riskTotal}
            t={t}
          />
        </Layout.Section>

        {/* ── KPI strip (current 30d + MoM delta) ─────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <div className={styles.sectionTitle}>
                <Text as="h3" variant="headingMd">
                  {t("fraudIntel.section30dTitle")}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("fraudIntel.section30dSubtitle")}
                </Text>
              </div>
              <div className={styles.kpiStrip}>
                <KpiTile
                  label={t("fraudIntel.kpiAcceptanceRate")}
                  value={formatPct(current30d.acceptanceRatePct)}
                  current={current30d.acceptanceRatePct}
                  prior={prior30d.acceptanceRatePct}
                  t={t}
                />
                <KpiTile
                  label={t("fraudIntel.kpiHighRiskRate")}
                  value={formatPct(current30d.highRiskPct)}
                  current={current30d.highRiskPct}
                  prior={prior30d.highRiskPct}
                  inverseDelta
                  t={t}
                />
                <KpiTile
                  label={t("fraudIntel.kpiFraudDisputeRate")}
                  value={formatPct(current30d.fraudDisputeRatePct, 2)}
                  current={current30d.fraudDisputeRatePct}
                  prior={prior30d.fraudDisputeRatePct}
                  inverseDelta
                  t={t}
                />
                <KpiTile
                  label={t("fraudIntel.kpiHighRiskFulfilled")}
                  value={formatPct(current30d.fulfilledHighRiskPct)}
                  current={current30d.fulfilledHighRiskPct}
                  prior={prior30d.fulfilledHighRiskPct}
                  inverseDelta
                  t={t}
                />
                <KpiTile
                  label={t("fraudIntel.kpiProtectCoverage")}
                  value={formatPct(current30d.shopifyProtectCoveragePct)}
                  current={current30d.shopifyProtectCoveragePct}
                  prior={prior30d.shopifyProtectCoveragePct}
                  t={t}
                />
                <KpiTile
                  label={t("fraudIntel.kpi3dsAuth")}
                  value={formatPct(current30d.threeDsAuthRatePct)}
                  current={current30d.threeDsAuthRatePct}
                  prior={prior30d.threeDsAuthRatePct}
                  context={t("fraudIntel.kpi3dsAuthContext", {
                    num: current30d.threeDsAuthOrders.toLocaleString(),
                    den: current30d.threeDsAuthEligibleOrders.toLocaleString(),
                  })}
                  t={t}
                />
                <KpiTile
                  label={t("fraudIntel.kpiMedianFulfillment")}
                  value={
                    current30d.medianFulfillmentHours === null
                      ? "—"
                      : current30d.medianFulfillmentHours < 24
                        ? `${current30d.medianFulfillmentHours.toFixed(1)} h`
                        : `${(current30d.medianFulfillmentHours / 24).toFixed(1)} d`
                  }
                  current={current30d.medianFulfillmentHours}
                  prior={prior30d.medianFulfillmentHours}
                  inverseDelta
                  deltaUnit="h"
                  context={t("fraudIntel.kpiMedianFulfillmentContext", {
                    count: current30d.fulfilledOrdersCount.toLocaleString(),
                  })}
                  t={t}
                />
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Risk classification breakdown (all-time) ───────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div className={styles.sectionTitle}>
                <Text as="h3" variant="headingMd">
                  {t("fraudIntel.riskBreakdownTitle")}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {riskTotal.toLocaleString()} {t("fraudIntel.ordersWordTotal")}
                </Text>
              </div>

              <div>
                <StackedDistributionBar segments={distSegments} />
                <StackedLegend segments={distSegments} total={riskTotal} />
              </div>

              <Banner tone="info" title={t("fraudIntel.breakdownExplainBannerTitle")}>
                <p>{t("fraudIntel.breakdownExplainBannerBody")}</p>
              </Banner>

              <Divider />

              <BlockStack gap="150">
                <Text as="h4" variant="headingSm">
                  {t("fraudIntel.breakdownExplainTitle")}
                </Text>
                <BreakdownExplainRow
                  label={t("fraudIntel.riskHigh")}
                  body={t("fraudIntel.breakdownExplainHigh")}
                  color={RISK_COLOR.HIGH}
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskMedium")}
                  body={t("fraudIntel.breakdownExplainMedium")}
                  color={RISK_COLOR.MEDIUM}
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskLow")}
                  body={t("fraudIntel.breakdownExplainLow")}
                  color={RISK_COLOR.LOW}
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskPending")}
                  body={t("fraudIntel.breakdownExplainPending")}
                  color={RISK_COLOR.PENDING}
                />
                <BreakdownExplainRow
                  label={t("fraudIntel.riskNone")}
                  body={t("fraudIntel.breakdownExplainCleared")}
                  color={RISK_COLOR.NONE}
                  emphasize
                />
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ── Two-column: correlation + chargeback gauge ─────────── */}
        {data.riskToDisputeConversion ? (
          <Layout.Section variant="oneHalf">
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
                <ConversionBarChart
                  insufficientLabel={t("fraudIntel.correlationInsufficient")}
                  rows={[
                    { label: t("fraudIntel.riskHigh"),   color: RISK_COLOR.HIGH,    bucket: data.riskToDisputeConversion.high },
                    { label: t("fraudIntel.riskMedium"), color: RISK_COLOR.MEDIUM,  bucket: data.riskToDisputeConversion.medium },
                    { label: t("fraudIntel.riskLow"),    color: RISK_COLOR.LOW,     bucket: data.riskToDisputeConversion.low },
                    { label: t("fraudIntel.riskNone"),   color: RISK_COLOR.NONE,    bucket: data.riskToDisputeConversion.none },
                  ]}
                />
                <Divider />
                <div className={styles.observationAccent}>
                  <CorrelationObservation
                    conversion={data.riskToDisputeConversion}
                    t={t}
                  />
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section variant="oneHalf">
          <Card>
            <div id="chargeback-health">
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  {t("fraudIntel.chargebackHealthTitle")}
                </Text>
                <ChargebackGauge
                  rate={data.chargebackRate90d}
                  status={data.chargebackHealth}
                  available={data.chargebackHealthAvailable}
                  statusLabel={t(
                    `fraudIntel.bannerHealth_${data.chargebackHealth}`,
                  )}
                  insufficientLabel={t(
                    "fraudIntel.chargebackHealthInsufficientTitle",
                  )}
                  bandsLabel={t("fraudIntel.gauge90dLabel")}
                  goodLabel={t("fraudIntel.gaugeBandGood")}
                  atRiskLabel={t("fraudIntel.gaugeBandAtRisk")}
                  elevatedLabel={t("fraudIntel.gaugeBandElevated")}
                />
                <Divider />
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                  gap="300"
                >
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm" fontWeight="semibold">
                      {t("fraudIntel.sparklineTitle")}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("fraudIntel.sparklineSubtitle")}
                    </Text>
                  </BlockStack>
                  <Sparkline points={data.chargebackRateSparklineWeekly} />
                </InlineStack>
                {!data.chargebackHealthAvailable ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("fraudIntel.chargebackHealthInsufficientBody", {
                      count: data.chargebackOrders90d.toLocaleString(),
                    })}
                  </Text>
                ) : null}
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("fraudIntel.chargebackHealthExplain")}
                </Text>
              </BlockStack>
            </div>
          </Card>
        </Layout.Section>

        {/* ── "What this means" footer ───────────────────────────── */}
        <Layout.Section>
          <div className={styles.footerCard}>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  {t("fraudIntel.whatThisMeansTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("fraudIntel.whatThisMeansBody")}
                </Text>
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/** Inline explanation row for each risk bucket. Dot mirrors the
 *  matching distribution color. */
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

/** Observation footer on the correlation card. Compares HIGH
 *  conversion to the blended LOW+NONE baseline and surfaces one of
 *  the localized observation variants. */
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
  const safeOrders = low.orders + none.orders;
  const safeDisputes = low.disputes + none.disputes;
  const safeBlendPct = safeOrders > 0 ? (safeDisputes / safeOrders) * 100 : null;
  if (
    safeBlendPct === null ||
    (low.conversionPct === null && none.conversionPct === null)
  ) {
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {t("fraudIntel.correlationObservationNeedSafe")}
      </Text>
    );
  }
  const ratio = safeBlendPct > 0 ? high.conversionPct / safeBlendPct : null;
  if (ratio === null) return null;

  if (ratio >= 2.0) {
    return (
      <Text as="p" variant="bodyMd">
        {t("fraudIntel.correlationObservationStrong", { ratio: ratio.toFixed(1) })}
      </Text>
    );
  }
  if (ratio >= 1.3) {
    return (
      <Text as="p" variant="bodyMd">
        {t("fraudIntel.correlationObservationMild", { ratio: ratio.toFixed(1) })}
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

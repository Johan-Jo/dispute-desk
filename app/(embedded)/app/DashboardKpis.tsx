"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BlockStack, Icon, Text, Tooltip, useBreakpoints } from "@shopify/polaris";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CashDollarIcon,
  ChartLineIcon,
  InfoIcon,
} from "@shopify/polaris-icons";
import styles from "./dashboard.module.css";
import {
  useDateLocale,
  useFormatCurrency,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";

/** Threshold-tone tuple per PRD §8. Same order/colors as the
 *  status hero in OverviewTab so merchants get a consistent
 *  green-amber-red signal across surfaces. */
type ThresholdTone = "healthy" | "watch" | "high";

function classifyChargebackRate(rate: number | null): ThresholdTone | null {
  if (rate === null) return null;
  if (rate < 0.6) return "healthy";
  if (rate <= 0.9) return "watch";
  return "high";
}

const TONE_PALETTE: Record<ThresholdTone, { bg: string; color: string; label: string }> = {
  healthy: { bg: "#D1FAE5", color: "#065F46", label: "" },
  watch:   { bg: "#FEF3C7", color: "#92400E", label: "" },
  high:    { bg: "#FEE2E2", color: "#991B1B", label: "" },
};

function ChangeIndicator({
  value,
  label,
  inverse = false,
  unit = "%",
}: {
  value: number | null;
  label: string;
  /** When true, "up = bad" (red) and "down = good" (green). Used for
   *  metrics where an increase is the negative outcome — chargeback
   *  rate, error rate, etc. Defaults false to preserve the existing
   *  active-disputes / win-rate / amount-at-risk semantics. */
  inverse?: boolean;
  /** Display unit for the delta. Existing tiles render `%`; chargeback
   *  rate renders `pp` (percentage points) per PRD §7. */
  unit?: "%" | "pp";
}) {
  if (value === null || value === undefined) return null;
  const isPositive = value > 0;
  const isNegative = value < 0;
  const goodColor = "#10B981";
  const badColor = "#EF4444";
  const color = isPositive
    ? (inverse ? badColor : goodColor)
    : isNegative
      ? (inverse ? goodColor : badColor)
      : "#9CA3AF";
  const formatted = unit === "pp" ? value.toFixed(1) : String(value);
  const suffix = unit === "pp" ? " pp" : "%";
  return (
    <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
      <span style={{ fontWeight: 500, color }}>
        {isPositive ? "+" : ""}{formatted}{suffix}
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
  /** When true, "up = bad" for the change indicator. */
  changeInverse?: boolean;
  /** Display unit for the change indicator. Defaults to `%`; chargeback
   *  rate uses `pp` per PRD §7. */
  changeUnit?: "%" | "pp";
  /** Optional inline pill rendered to the right of the value. Used by
   *  the chargeback rate tile to surface the Healthy / Watch / High
   *  risk threshold band per PRD §8. */
  badge?: { label: string; tone: ThresholdTone };
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
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <p style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>
          {loading ? "—" : card.value}
        </p>
        {card.badge && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              lineHeight: 1.4,
              background: TONE_PALETTE[card.badge.tone].bg,
              color: TONE_PALETTE[card.badge.tone].color,
              whiteSpace: "nowrap",
            }}
          >
            {card.badge.label}
          </span>
        )}
      </div>
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator
          value={card.change}
          label={vsLabel}
          inverse={card.changeInverse}
          unit={card.changeUnit}
        />
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
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <p className={styles.value}>{loading ? "—" : card.value}</p>
        {card.badge && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "6px",
              fontSize: "11px",
              fontWeight: 600,
              lineHeight: 1.4,
              background: TONE_PALETTE[card.badge.tone].bg,
              color: TONE_PALETTE[card.badge.tone].color,
              whiteSpace: "nowrap",
            }}
          >
            {card.badge.label}
          </span>
        )}
      </div>
      <div style={{ marginTop: "6px" }}>
        <ChangeIndicator
          value={card.change}
          label={vsLabel}
          inverse={card.changeInverse}
          unit={card.changeUnit}
        />
      </div>
    </div>
  );
}

/**
 * Chargeback rate tile — Figma alignment 2026-05-01.
 *
 * Structurally distinct from `DesktopKpiTile` / `MobileKpiTile`
 * because the Figma chargeback card carries affordances the standard
 * tile doesn't have:
 *   - Info icon next to the label with a hover tooltip explaining
 *     the threshold bands + a card-network penalty footnote.
 *   - Threshold pill in the **title row top-right** (replaces the
 *     icon chip the other 4 tiles use).
 *   - Value + delta on the **same row** (`flex items-end justify-
 *     between`), not stacked.
 *
 * Other 4 KPI tiles (Active / Win / Recovered / At risk) keep their
 * current styling — explicitly out of scope per the Figma rework
 * brief ("align with the current design").
 */
function ChargebackKpiTile({
  rate,
  delta,
  available,
  band,
  bandLabel,
  loading,
}: {
  rate: number | null;
  delta: number | null;
  available: boolean;
  band: ThresholdTone | null;
  bandLabel: string | null;
  loading: boolean;
}) {
  const t = useTranslations();
  const tooltipContent = (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm">
        <strong>{t("dashboard.chargebackRateThresholdHealthy")}:</strong>{" "}
        below 0.6%
      </Text>
      <Text as="p" variant="bodySm">
        <strong>{t("dashboard.chargebackRateThresholdWatch")}:</strong>{" "}
        0.6%–0.9%
      </Text>
      <Text as="p" variant="bodySm">
        <strong>{t("dashboard.chargebackRateThresholdHigh")}:</strong>{" "}
        above 0.9%
      </Text>
      <Text as="p" variant="bodyXs" tone="subdued">
        {t("dashboard.chargebackRateTooltipFootnote")}
      </Text>
    </BlockStack>
  );

  const display = loading || !available || rate === null
    ? "—"
    : `${rate.toFixed(1)}%`;

  // 3-row layout — matches the other 4 KPI tiles (title → value →
  // change). Figma's `shopify-home.tsx` uses a 2-row inline-delta
  // design that works at its xl-width mock but breaks the visual
  // rhythm in our narrower 5-column grid (value sinks to the bottom
  // with empty space above). Keeping all the Figma affordances
  // — label, info tooltip, threshold pill, arrow + pp delta — just
  // distributing them across 3 rows so heights and content
  // anchoring align with Active / Win / Recovered / At Risk.
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "10px",
        border: "1px solid #E1E3E5",
        padding: "16px",
      }}
    >
      {/* Row 1 — title (label + info icon) | threshold pill */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            minWidth: 0,
            flex: 1,
          }}
        >
          <p
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: "#6D7175",
              margin: 0,
              lineHeight: 1.35,
              wordBreak: "normal",
              overflowWrap: "anywhere",
            }}
          >
            {t("dashboard.chargebackRate")}
          </p>
          <Tooltip content={tooltipContent} preferredPosition="below">
            <button
              type="button"
              aria-label={t("dashboard.chargebackRate")}
              style={{
                appearance: "none",
                background: "transparent",
                border: 0,
                padding: 0,
                cursor: "help",
                display: "inline-flex",
                color: "#6D7175",
                width: "12px",
                height: "12px",
                flexShrink: 0,
                marginTop: "2px",
              }}
            >
              <Icon source={InfoIcon} />
            </button>
          </Tooltip>
        </div>
        {band && bandLabel && (
          <span
            style={{
              padding: "2px 6px",
              borderRadius: "6px",
              fontSize: "10px",
              fontWeight: 600,
              lineHeight: 1.4,
              background: TONE_PALETTE[band].bg,
              color: TONE_PALETTE[band].color,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {bandLabel}
          </span>
        )}
      </div>

      {/* Row 2 — value (large, alone). Sits in the middle of the
          card, matching where the other 4 tiles place their value. */}
      <p style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>
        {display}
      </p>

      {/* Row 3 — arrow + pp delta. Same vertical position as the
          other tiles' "X% vs last month" change indicator. */}
      <div style={{ marginTop: "6px", minHeight: "18px" }}>
        {available && delta !== null && <ChargebackDelta value={delta} />}
      </div>
    </div>
  );
}

/** Inline arrow + value chip for the chargeback rate card.
 *  Up = red (rate climbing is bad), down = green, zero = neutral. */
function ChargebackDelta({ value }: { value: number }) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const color = isPositive ? "#DC2626" : isNegative ? "#059669" : "#6D7175";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "12px",
        fontWeight: 500,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {(isPositive || isNegative) && (
        <span style={{ width: "12px", height: "12px", display: "inline-flex", color }}>
          <Icon source={isPositive ? ArrowUpIcon : ArrowDownIcon} />
        </span>
      )}
      {isPositive ? "+" : ""}
      {value.toFixed(1)} pp
    </span>
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
    changeInverse: true,
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
    changeInverse: true,
  };

  // ── Chargeback rate (PRD §8 / Figma 2026-05-01) ─────────────────────
  // Rendered via a dedicated `ChargebackKpiTile` rather than the shared
  // `DesktopKpiTile` because Figma gives this card a distinct title row
  // (label + info tooltip + threshold pill in top-right) and a value+
  // delta inline row. The other 4 KPI tiles keep their existing shape.
  const chargebackBand = classifyChargebackRate(stats.chargebackRate);
  const chargebackBandLabel =
    chargebackBand === "healthy"
      ? t("dashboard.chargebackRateThresholdHealthy")
      : chargebackBand === "watch"
        ? t("dashboard.chargebackRateThresholdWatch")
        : chargebackBand === "high"
          ? t("dashboard.chargebackRateThresholdHigh")
          : null;

  const desktopCards = [active, winRate, recovered, atRisk];

  const chargebackTile = (
    <ChargebackKpiTile
      rate={stats.chargebackRate}
      delta={stats.chargebackRateAvailable ? stats.chargebackRateChange : null}
      available={stats.chargebackRateAvailable}
      band={chargebackBand}
      bandLabel={chargebackBandLabel}
      loading={loading}
    />
  );

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
            {/* Row 4: Chargeback Rate — full width on mobile so the
                threshold pill + info tooltip + delta have room to
                render without wrapping. */}
            {chargebackTile}
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
            {chargebackTile}
          </div>
        </>
      )}
      <ChargebackRateDetailsStrip stats={stats} loading={loading} />
    </div>
  );
}

/**
 * Inline details strip below the KPI row (PRD §8 Task 2).
 *
 * NOT a card — sits inside the existing Performance Overview container
 * with a subtle border-top divider so it visually attaches to the KPI
 * row. Default state: a right-aligned `Details` link only. Expanded:
 * numerator/denominator, pp delta, last-synced timestamp, plus optional
 * low-volume and approaching-threshold hints.
 *
 * Hides itself entirely when:
 *   - The dashboard is in its initial loading state, or
 *   - The chargeback snapshot is unavailable AND there's no last-synced
 *     timestamp to show — there's nothing useful to expand to.
 */
function ChargebackRateDetailsStrip({
  stats,
  loading,
}: {
  stats: DashboardStats;
  loading: boolean;
}) {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const [expanded, setExpanded] = useState(false);

  if (loading) return null;

  // Figma `shopify-home.tsx` always renders the Details button —
  // there is no `if (!available) return null` guard. The expanded
  // panel below gracefully degrades to a single "Calculating…" line
  // when no snapshot exists yet (fresh install, mid-backfill).

  const numberFmt = (n: number) => new Intl.NumberFormat(dateLocale).format(n);
  const change = stats.chargebackRateChange;

  const deltaLabel = (() => {
    if (change === null || change === undefined) return null;
    if (change > 0) {
      return t("dashboard.chargebackRateDeltaIncrease", {
        value: change.toFixed(1),
      });
    }
    if (change < 0) {
      return t("dashboard.chargebackRateDeltaDecrease", {
        value: Math.abs(change).toFixed(1),
      });
    }
    return t("dashboard.chargebackRateDeltaFlat");
  })();

  const lastSyncedLabel = stats.chargebackRateLastSyncedAt
    ? t("dashboard.chargebackRateLastSynced", {
        ago: relativeTime(t, stats.chargebackRateLastSyncedAt),
      })
    : null;

  // Figma 2026-05-01 — "Approaching risk threshold (0.9%)" surfaces
  // whenever rate ≥ 0.7%, which spans the upper Watch band through
  // High risk. Matches the literal Figma trigger (`shopify-home.tsx`).
  const approachingThreshold =
    stats.chargebackRateAvailable &&
    stats.chargebackRate !== null &&
    stats.chargebackRate >= 0.7;

  const showLowVolume =
    stats.chargebackRateAvailable && stats.chargebackRateLowVolume;

  return (
    <div
      style={{
        marginTop: "12px",
        paddingTop: "8px",
        borderTop: "1px solid #E1E3E5",
      }}
    >
      {/* Top row — Details button right-aligned, always visible.
          Matches Figma `shopify-home.tsx:331-339` literally. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            appearance: "none",
            background: "transparent",
            border: 0,
            padding: 0,
            fontSize: "12px",
            fontWeight: 500,
            color: "#005BD3",
            cursor: "pointer",
            fontFamily: "inherit",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        >
          {expanded
            ? t("dashboard.chargebackRateDetailsHide")
            : t("dashboard.chargebackRateDetailsShow")}
        </button>
      </div>

      {/* Expanded panel — vertical stack of subdued lines. Matches
          Figma `shopify-home.tsx:340-365` (`space-y-1.5`). When the
          snapshot is missing the panel collapses to a single
          "Calculating…" line so the affordance still feels responsive. */}
      {expanded && (
        <div
          style={{
            marginTop: "8px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {!stats.chargebackRateAvailable ? (
            <span style={{ fontSize: "12px", color: "#6D7175", fontStyle: "italic" }}>
              {t("dashboard.chargebackRateUnavailable")}
            </span>
          ) : (
            <>
              <div style={{ fontSize: "12px", color: "#6D7175", lineHeight: 1.4 }}>
                <span style={{ fontWeight: 500, color: "#202223" }}>
                  {numberFmt(stats.chargebackRateNumerator)}{" "}
                  {stats.chargebackRateNumerator === 1 ? "chargeback" : "chargebacks"}
                </span>
                {" / "}
                {numberFmt(stats.chargebackRateDenominator)} orders
              </div>
              {deltaLabel && (
                <div
                  style={{
                    fontSize: "12px",
                    color:
                      change !== null && change > 0
                        ? "#DC2626"
                        : change !== null && change < 0
                          ? "#059669"
                          : "#6D7175",
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }}
                >
                  {deltaLabel}
                </div>
              )}
              {approachingThreshold && (
                <div style={{ fontSize: "12px", color: "#92400E", lineHeight: 1.4 }}>
                  {t("dashboard.chargebackRateApproachingThreshold")}
                </div>
              )}
              {lastSyncedLabel && (
                <div style={{ fontSize: "12px", color: "#8C9196", lineHeight: 1.4 }}>
                  {lastSyncedLabel}
                </div>
              )}
              {showLowVolume && (
                <div style={{ marginTop: "4px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      background: "#FEF3C7",
                      color: "#92400E",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      fontWeight: 500,
                    }}
                  >
                    {t("dashboard.chargebackRateLowVolume")}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function relativeTime(
  t: ReturnType<typeof useTranslations>,
  iso: string,
): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return t("dashboard.chargebackRateRelativeNever");
  if (ms < 60_000) return t("dashboard.chargebackRateRelativeJustNow");
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return t("dashboard.chargebackRateRelativeMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("dashboard.chargebackRateRelativeHours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("dashboard.chargebackRateRelativeDays", { count: days });
}


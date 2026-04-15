/**
 * Merchant dashboard — dispute operations console.
 *
 * Driven by the normalized dispute-history model:
 * normalized_status, submission_state, final_outcome,
 * submitted_at, closed_at, outcome_amount_recovered/lost,
 * last_event_at, needs_attention.
 */
"use client";

import { Suspense, useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Spinner,
  ProgressBar,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  ChartLineIcon,
  CashDollarIcon,
  QuestionCircleIcon,
} from "@shopify/polaris-icons";
import { useTranslations, useLocale } from "next-intl";
import type { SetupStateResponse } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import { shopifyOrderAdminUrl } from "@/lib/embedded/shopifyOrderUrl";
import {
  recentDisputesOrderLinkStyle,
  recentDisputesTdStyle,
  recentDisputesThStyle,
  recentDisputesViewDetailsLinkStyle,
} from "@/lib/embedded/recentDisputesTableStyles";
import { useSearchParams, useRouter } from "next/navigation";

type PeriodKey = "24h" | "7d" | "30d" | "all";

interface ActivityItem {
  id: string;
  disputeId: string;
  orderName: string;
  eventType: string;
  description: string | null;
  eventAt: string;
  actorType: string;
}

interface DashboardStats {
  activeDisputes: number;
  winRate: number;
  packCount: number;
  amountAtRisk: number;
  amountRecovered: number;
  amountLost: number;
  currencyCode: string;
  disputesWon: number;
  disputesLost: number;
  totalClosed: number;
  avgTimeToSubmit: number | null;
  avgTimeToClose: number | null;
  activeDisputesChange: number | null;
  winRateChange: number | null;
  amountAtRiskChange: number | null;
  amountRecoveredChange: number | null;
  disputesWonChange: number | null;
  inquiryCount: number;
  chargebackCount: number;
  needsAttentionCount: number;
  statusBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;
  submissionBreakdown: Record<string, number>;
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
  recentActivity: ActivityItem[];
}

const DEFAULT_STATS: DashboardStats = {
  activeDisputes: 0,
  winRate: 0,
  packCount: 0,
  amountAtRisk: 0,
  amountRecovered: 0,
  amountLost: 0,
  currencyCode: "USD",
  disputesWon: 0,
  disputesLost: 0,
  totalClosed: 0,
  avgTimeToSubmit: null,
  avgTimeToClose: null,
  activeDisputesChange: null,
  winRateChange: null,
  amountAtRiskChange: null,
  amountRecoveredChange: null,
  disputesWonChange: null,
  inquiryCount: 0,
  chargebackCount: 0,
  needsAttentionCount: 0,
  statusBreakdown: {},
  outcomeBreakdown: {},
  submissionBreakdown: {},
  winRateTrend: [0, 0, 0, 0, 0, 0],
  disputeCategories: [],
  recentActivity: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function useDateLocale() {
  const locale = useLocale();
  return useMemo(() => {
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("de")) return "de-DE";
    if (locale.startsWith("sv")) return "sv-SE";
    if (locale.startsWith("es")) return "es-ES";
    if (locale.startsWith("fr")) return "fr-FR";
    return "en-US";
  }, [locale]);
}

function useFormatCurrency(currencyCode: string) {
  const dateLocale = useDateLocale();
  return useCallback(
    (amount: number, maxFrac = 0) =>
      new Intl.NumberFormat(dateLocale, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: maxFrac,
      }).format(amount),
    [dateLocale, currencyCode],
  );
}

function ChangeIndicator({ value, label }: { value: number | null; label: string }) {
  if (value === null || value === undefined) return null;
  const isPositive = value > 0;
  const isNegative = value < 0;
  return (
    <span style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
      <span style={{ fontWeight: 500, color: isPositive ? "#10B981" : isNegative ? "#EF4444" : "#9CA3AF" }}>
        {isPositive ? "+" : ""}{value}%
      </span>
      <span style={{ color: "#9CA3AF" }}>{label}</span>
    </span>
  );
}

function PeriodSelector({ period, onChange, t }: { period: PeriodKey; onChange: (p: PeriodKey) => void; t: ReturnType<typeof useTranslations> }) {
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

// ─── 1. Operational Summary Card ──────────────────────────────────────────

function OperationalSummaryCard({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const s = stats;

  const actionNeeded = (s.statusBreakdown["action_needed"] ?? 0) + (s.statusBreakdown["needs_review"] ?? 0);
  const readyToSubmit = s.statusBreakdown["ready_to_submit"] ?? 0;
  const waitingOnIssuer = s.statusBreakdown["waiting_on_issuer"] ?? 0;

  // Primary CTA: action needed → ready to submit → view all
  let ctaLabel = t("dashboard.viewAllDisputes");
  let ctaUrl = withShopParams("/app/disputes", searchParams);
  if (actionNeeded > 0) {
    ctaLabel = t("dashboard.reviewActionNeeded", { count: actionNeeded });
    ctaUrl = withShopParams("/app/disputes?normalized_status=action_needed,needs_review", searchParams);
  } else if (readyToSubmit > 0) {
    ctaLabel = t("dashboard.submitReady", { count: readyToSubmit });
    ctaUrl = withShopParams("/app/disputes?normalized_status=ready_to_submit", searchParams);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{t("dashboard.operationalSummary")}</Text>
          <InlineStack gap="200" blockAlign="center">
            {s.needsAttentionCount > 0 && (
              <Badge tone="critical">{t("dashboard.attentionCount", { count: s.needsAttentionCount })}</Badge>
            )}
            <Button variant="primary" size="slim" url={ctaUrl}>{ctaLabel}</Button>
          </InlineStack>
        </InlineStack>

        {loading ? (
          <InlineStack align="center"><Spinner size="small" /></InlineStack>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px" }}>
            <SummaryCounter
              label={t("dashboard.actionNeeded")}
              count={actionNeeded}
              tone={actionNeeded > 0 ? "critical" : "subdued"}
              url={withShopParams("/app/disputes?normalized_status=action_needed,needs_review", searchParams)}
            />
            <SummaryCounter
              label={t("dashboard.readyToSubmit")}
              count={readyToSubmit}
              tone={readyToSubmit > 0 ? "warning" : "subdued"}
              url={withShopParams("/app/disputes?normalized_status=ready_to_submit", searchParams)}
            />
            <SummaryCounter
              label={t("dashboard.waitingOnIssuer")}
              count={waitingOnIssuer}
              tone="subdued"
              url={withShopParams("/app/disputes?normalized_status=waiting_on_issuer", searchParams)}
            />
            <SummaryCounter
              label={t("dashboard.closedInPeriod")}
              count={s.totalClosed}
              tone="subdued"
            />
          </div>
        )}
      </BlockStack>
    </Card>
  );
}

function SummaryCounter({ label, count, tone, url }: {
  label: string;
  count: number;
  tone: "critical" | "warning" | "subdued";
  url?: string;
}) {
  const colors = {
    critical: { bg: "#FEE2E2", text: "#DC2626", num: "#B91C1C" },
    warning: { bg: "#FEF3C7", text: "#D97706", num: "#B45309" },
    subdued: { bg: "#F3F4F6", text: "#6B7280", num: "#374151" },
  };
  const c = count > 0 ? colors[tone] : colors.subdued;

  const inner = (
    <div style={{
      background: c.bg,
      borderRadius: "10px",
      padding: "14px 16px",
      cursor: url ? "pointer" : undefined,
    }}>
      <p style={{ fontSize: "12px", fontWeight: 500, color: c.text, margin: 0 }}>{label}</p>
      <p style={{ fontSize: "28px", fontWeight: 700, color: c.num, margin: "4px 0 0" }}>{count}</p>
    </div>
  );

  return url ? <Link href={url} style={{ textDecoration: "none" }}>{inner}</Link> : inner;
}

// ─── 2. KPI Section ───────────────────────────────────────────────────────

function DashboardKpis({ stats, loading, period, onPeriodChange }: {
  stats: DashboardStats;
  loading: boolean;
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency(stats.currencyCode);
  const vsLabel = t("dashboard.vsLastMonth");

  const kpiCards = [
    {
      icon: AlertCircleIcon,
      label: t("dashboard.activeDisputes"),
      value: String(stats.activeDisputes),
      change: stats.activeDisputesChange,
    },
    {
      icon: ChartLineIcon,
      label: t("dashboard.winRate"),
      value: `${stats.winRate}%`,
      change: stats.winRateChange,
    },
    {
      icon: CashDollarIcon,
      label: t("dashboard.amountRecovered"),
      value: formatCurrency(stats.amountRecovered),
      change: stats.amountRecoveredChange,
    },
    {
      icon: CashDollarIcon,
      label: t("dashboard.amountLostKpi"),
      value: formatCurrency(stats.amountLost),
      change: null,
    },
    {
      icon: CashDollarIcon,
      label: t("dashboard.amountAtRisk"),
      value: formatCurrency(stats.amountAtRisk),
      change: stats.amountAtRiskChange,
    },
  ];

  return (
    <div style={{
      background: "#fff",
      borderRadius: "12px",
      border: "1px solid #E5E7EB",
      padding: "20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
        <Text as="h2" variant="headingMd">{t("dashboard.performanceOverview")}</Text>
        <PeriodSelector period={period} onChange={onPeriodChange} t={t} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
        {kpiCards.map((card) => (
          <div
            key={card.label}
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
                background: "#EDE9FE",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: "#7C3AED",
              }}>
                <Icon source={card.icon} />
              </div>
            </div>
            <p style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>
              {loading ? "—" : card.value}
            </p>
            <div style={{ marginTop: "6px" }}>
              <ChangeIndicator value={card.change} label={vsLabel} />
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  new: "#6B7280",
  in_progress: "#3B82F6",
  needs_review: "#F59E0B",
  ready_to_submit: "#8B5CF6",
  action_needed: "#EF4444",
  submitted: "#06B6D4",
  waiting_on_issuer: "#6366F1",
  won: "#10B981",
  lost: "#DC2626",
  accepted_not_contested: "#9CA3AF",
  closed_other: "#9CA3AF",
};

function safeStatusLabel(t: ReturnType<typeof useTranslations>, status: string): string {
  try {
    const result = t(`normalizedStatuses.${status}`);
    if (result.startsWith("disputeTimeline.")) return status.replace(/_/g, " ");
    return result;
  } catch {
    return status.replace(/_/g, " ");
  }
}

// ─── 4. Outcome Breakdown ─────────────────────────────────────────────────

const OUTCOME_COLORS: Record<string, string> = {
  won: "#10B981",
  lost: "#EF4444",
  partially_won: "#F59E0B",
  accepted: "#6B7280",
  refunded: "#6B7280",
  canceled: "#9CA3AF",
  expired: "#9CA3AF",
  closed_other: "#9CA3AF",
  unknown: "#D1D5DB",
};

function OutcomeBreakdown({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const tTimeline = useTranslations("disputeTimeline");

  if (loading) return null;

  const entries = Object.entries(stats.outcomeBreakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingSm">{t("dashboard.outcomeBreakdown")}</Text>
        <BlockStack gap="200">
          {entries.map(([outcome, count]) => {
            const pct = Math.round((count / total) * 100);
            return (
              <div key={outcome}>
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: OUTCOME_COLORS[outcome] ?? "#9CA3AF", flexShrink: 0 }} />
                    <Text as="span" variant="bodyMd">{safeOutcomeLabel(tTimeline, outcome)}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">{count} ({pct}%)</Text>
                </InlineStack>
                <div style={{ marginTop: "4px" }}>
                  <ProgressBar progress={pct} size="small" tone={outcome === "won" ? "success" : outcome === "lost" ? "critical" : undefined} />
                </div>
              </div>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

function safeOutcomeLabel(t: ReturnType<typeof useTranslations>, outcome: string): string {
  try {
    const result = t(`outcomes.${outcome}`);
    if (result.startsWith("disputeTimeline.")) return outcome.replace(/_/g, " ");
    return result;
  } catch {
    return outcome.replace(/_/g, " ");
  }
}

// ─── 6. Recent Activity Feed ──────────────────────────────────────────────

function RecentActivityFeed({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const tTimeline = useTranslations("disputeTimeline");
  const dateLocale = useDateLocale();
  const searchParams = useSearchParams();

  if (loading) return null;
  if (stats.recentActivity.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingSm">{t("dashboard.recentActivity")}</Text>
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {stats.recentActivity.map((item) => {
            const eventLabel = safeEventLabel(tTimeline, item.eventType);
            const timeStr = new Date(item.eventAt).toLocaleDateString(dateLocale, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <Link
                key={item.id}
                href={withShopParams(`/app/disputes/${item.disputeId}`, searchParams)}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 4px",
                  borderRadius: "6px",
                }}>
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    background: STATUS_COLORS[item.eventType] ?? "#3B82F6",
                    flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "13px", fontWeight: 500, color: "#111827", margin: 0 }}>
                      {eventLabel}
                    </p>
                    <p style={{ fontSize: "12px", color: "#6B7280", margin: 0 }}>
                      {item.orderName}
                      {(() => {
                        const desc = localizeEventDescription(tTimeline, item.eventType, item.description);
                        return desc ? ` — ${desc}` : "";
                      })()}
                    </p>
                  </div>
                  <span style={{ fontSize: "12px", color: "#9CA3AF", flexShrink: 0 }}>{timeStr}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </BlockStack>
    </Card>
  );
}

function safeEventLabel(t: ReturnType<typeof useTranslations>, eventType: string): string {
  try {
    const result = t(`eventTypes.${eventType}`);
    if (result.startsWith("disputeTimeline.")) return eventType.replace(/_/g, " ");
    return result;
  } catch {
    return eventType.replace(/_/g, " ");
  }
}

/** Parse dynamic values from raw English descriptions and return a localized version. */
function localizeEventDescription(
  t: ReturnType<typeof useTranslations>,
  eventType: string,
  description: string | null,
): string | null {
  if (!description) return null;

  try {
    // Parse dynamic values from the raw English description based on event type
    switch (eventType) {
      case "submission_confirmed":
        return t("eventDescriptions.submission_confirmed");

      case "dispute_opened": {
        const m = description.match(/^(.+?) opened — (.+)$/);
        if (m) return t("eventDescriptions.dispute_opened", { type: m[1], reason: m[2] });
        break;
      }
      case "status_changed": {
        const m = description.match(/^(.+?) → (.+)$/);
        if (m) return t("eventDescriptions.status_changed", { from: m[1], to: m[2] });
        break;
      }
      case "due_date_changed": {
        const m = description.match(/^Due date changed to (.+)$/);
        if (m) return t("eventDescriptions.due_date_changed", { date: m[1] });
        break;
      }
      case "pack_created": {
        const m = description.match(/^Score: (\d+)%, (\d+) evidence items collected$/);
        if (m) return t("eventDescriptions.pack_created", { score: m[1], count: m[2] });
        break;
      }
      case "evidence_saved_to_shopify": {
        const m = description.match(/^(\d+) evidence fields sent to Shopify$/);
        if (m) return t("eventDescriptions.evidence_saved_to_shopify", { count: m[1] });
        break;
      }
      case "support_note_added": {
        const m = description.match(/^Note added by (.+)$/);
        if (m) return t("eventDescriptions.support_note_added", { role: m[1] });
        break;
      }
      case "dispute_resynced": {
        const m = description.match(/^Resynced by (.+?)\./);
        if (m) return t("eventDescriptions.dispute_resynced", { role: m[1] });
        break;
      }
    }
  } catch {
    // i18n key missing — fall through
  }

  return description;
}

// ─── 7. Recent Disputes Table ─────────────────────────────────────────────

interface DisputeRow {
  id: string;
  order: string;
  orderUrl: string | null;
  amount: string;
  reason: string | null;
  normalizedStatus: string | null;
  submissionState: string | null;
  nextAction: string | null;
  lastEventAt: string | null;
  dueAt: string | null;
  initiatedAt: string | null;
  finalOutcome: string | null;
}

function RecentDisputesTable() {
  const t = useTranslations();
  const tPacks = useTranslations("packs");
  const tTimeline = useTranslations("disputeTimeline");
  const dateLocale = useDateLocale();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/disputes?per_page=8&sort=due_at&sort_dir=asc").then((r) => (r.ok ? r.json() : { disputes: [] })),
      fetch("/api/billing/usage").then((r) => (r.ok ? r.json() : {})),
    ]).then(([disputeData, usageData]: [
      { disputes?: Array<Record<string, unknown>> },
      { shop_domain?: string | null },
    ]) => {
      if (cancelled) return;
      const shopDomain = usageData.shop_domain ?? null;
      const list = disputeData.disputes ?? [];
      setRows(
        list.map((d) => ({
          id: d.id as string,
          order: (d.order_name as string) ?? ((d.order_gid as string) ? `#${String(d.order_gid).slice(-4)}` : "—"),
          orderUrl: shopifyOrderAdminUrl(shopDomain, (d.order_gid as string) ?? null),
          amount: d.amount != null
            ? new Intl.NumberFormat(dateLocale, { style: "currency", currency: (d.currency_code as string) ?? "USD" }).format(Number(d.amount))
            : "—",
          reason: (d.reason as string) ?? null,
          normalizedStatus: (d.normalized_status as string) ?? null,
          submissionState: (d.submission_state as string) ?? null,
          nextAction: (d.next_action_text as string) ?? null,
          lastEventAt: (d.last_event_at as string) ?? null,
          dueAt: (d.due_at as string) ?? null,
          initiatedAt: (d.initiated_at as string) ?? null,
          finalOutcome: (d.final_outcome as string) ?? null,
        }))
      );
    })
    .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateLocale]);

  if (loading) {
    return (
      <Card>
        <BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
          <Text as="p" variant="bodyMd" tone="subdued">{t("dashboard.noDisputesYetDesc")}</Text>
          <Button url={withShopParams("/app/disputes", searchParams)}>{t("dashboard.goToDisputes")}</Button>
        </BlockStack>
      </Card>
    );
  }

  const formatReason = (reason: string | null) => {
    if (!reason) return "—";
    try { return tPacks(`disputeTypeLabel.${reason}`); } catch { /* fallback */ }
    return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const normalizedStatusBadge = (status: string | null) => {
    if (!status) return <Badge>{t("disputes.statusUnknown")}</Badge>;
    const toneMap: Record<string, "success" | "critical" | "warning" | "attention" | "info" | undefined> = {
      new: "info",
      in_progress: "info",
      needs_review: "attention",
      ready_to_submit: "attention",
      action_needed: "critical",
      submitted: "info",
      waiting_on_issuer: "info",
      won: "success",
      lost: "critical",
      accepted_not_contested: undefined,
      closed_other: undefined,
    };
    return (
      <Badge tone={toneMap[status]}>
        {safeStatusLabel(tTimeline, status)}
      </Badge>
    );
  };

  const submissionBadge = (state: string | null) => {
    if (!state || state === "not_saved") return <Text as="span" variant="bodySm" tone="subdued">—</Text>;
    const toneMap: Record<string, "success" | "critical" | "warning" | "attention" | "info" | undefined> = {
      saved_to_shopify: "warning",
      submitted_confirmed: "success",
      submission_uncertain: "attention",
      manual_submission_reported: "info",
    };
    let label: string;
    try {
      label = tTimeline(`submissionStates.${state}`);
      if (label.startsWith("disputeTimeline.")) label = state.replace(/_/g, " ");
    } catch {
      label = state.replace(/_/g, " ");
    }
    return <Badge tone={toneMap[state]}>{label}</Badge>;
  };

  const outcomeBadge = (outcome: string | null) => {
    if (!outcome) return null;
    const toneMap: Record<string, "success" | "critical" | "warning" | "attention" | "info" | undefined> = {
      won: "success",
      lost: "critical",
      partially_won: "warning",
    };
    return <Badge tone={toneMap[outcome]}>{safeOutcomeLabel(tTimeline, outcome)}</Badge>;
  };

  const formatShortDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(dateLocale, { month: "short", day: "numeric" });
  };

  const formatRelativeTime = (iso: string | null) => {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t("dashboard.minutesAgo", { count: Math.max(1, mins) });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("dashboard.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return t("dashboard.daysAgo", { count: days });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
          <Button variant="plain" url={withShopParams("/app/disputes", searchParams)}>{t("common.viewAll")}</Button>
        </InlineStack>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--p-color-border)" }}>
                <th style={recentDisputesThStyle}>{t("table.order")}</th>
                <th style={recentDisputesThStyle}>{t("table.amount")}</th>
                <th style={recentDisputesThStyle}>{t("table.reason")}</th>
                <th style={recentDisputesThStyle}>{t("dashboard.statusCol")}</th>
                <th style={recentDisputesThStyle}>{t("dashboard.submissionCol")}</th>
                <th style={recentDisputesThStyle}>{t("dashboard.lastEventCol")}</th>
                <th style={recentDisputesThStyle}>{t("table.deadline")}</th>
                <th style={recentDisputesThStyle}>{t("dashboard.outcomeCol")}</th>
                <th style={recentDisputesThStyle}>{t("table.date")}</th>
                <th style={recentDisputesThStyle}>{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                  <td style={recentDisputesTdStyle}>
                    {r.orderUrl ? (
                      <a href={r.orderUrl} target="_top" rel="noopener noreferrer" style={recentDisputesOrderLinkStyle}>
                        {r.order}
                      </a>
                    ) : (
                      <Text as="span" variant="bodySm" fontWeight="semibold">{r.order}</Text>
                    )}
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{r.amount}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatReason(r.reason)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>{normalizedStatusBadge(r.normalizedStatus)}</td>
                  <td style={recentDisputesTdStyle}>{submissionBadge(r.submissionState)}</td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatRelativeTime(r.lastEventAt)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatShortDate(r.dueAt)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>{outcomeBadge(r.finalOutcome)}</td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatShortDate(r.initiatedAt)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Link href={withShopParams(`/app/disputes/${r.id}`, searchParams)} style={recentDisputesViewDetailsLinkStyle}>
                      {t("table.viewDetails")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BlockStack>
    </Card>
  );
}

// ─── Charts (retained) ───────────────────────────────────────────────────

function DashboardCharts({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const tPacks = useTranslations("packs");

  const translateCategory = (label: string) => {
    try { return tPacks(`disputeTypeLabel.${label}`); } catch { /* fallback */ }
    return label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <>
      <Layout.Section variant="oneHalf">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("dashboard.winRateTrend")}</Text>
            {loading ? (
              <Spinner size="small" />
            ) : (
              <BlockStack gap="200">
                {stats.winRateTrend.map((pct, i) => (
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
      <Layout.Section variant="oneHalf">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("dashboard.disputeCategories")}</Text>
            {loading ? (
              <Spinner size="small" />
            ) : stats.disputeCategories.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.noDisputesYetDesc")}</Text>
            ) : (
              <BlockStack gap="300">
                {stats.disputeCategories.map(({ label, value }) => (
                  <BlockStack key={label} gap="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">{translateCategory(label)}</Text>
                      <Text as="span" variant="bodyMd" tone="subdued">{value}%</Text>
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

// ─── Help Card ────────────────────────────────────────────────────────────

function DashboardHelpCard() {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  return (
    <Card>
      <InlineStack gap="400" blockAlign="center" wrap={false}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: "#EDE9FE",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, color: "#7C3AED",
        }}>
          <Icon source={QuestionCircleIcon} />
        </div>
        <BlockStack gap="050">
          <Text as="h3" variant="headingSm">{t("helpCardTitle")}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{t("helpCardDesc")}</Text>
        </BlockStack>
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <Button variant="plain" url={withShopParams("/app/help/understanding-dashboard", searchParams)}>
            {t("helpCardLink")}
          </Button>
        </div>
      </InlineStack>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SetupStateResponse | null) => {
        if (cancelled) return;
        if (!data || data.allDone) {
          setSetupDone(true);
        } else {
          router.replace(withShopParams("/app/setup", searchParams));
        }
      });
    return () => { cancelled = true; };
  }, [router, searchParams]);

  useEffect(() => {
    if (!setupDone) return;
    let cancelled = false;
    setStatsLoading(true);
    fetch(`/api/dashboard/stats?period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [period, setupDone]);

  if (!setupDone) {
    return (
      <Page title="DisputeDesk">
        <Layout>
          <Layout.Section>
            <Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title={t("dashboard.embeddedPageTitle")}
      subtitle={t("dashboard.embeddedSubtitleNew")}
      secondaryActions={[{ content: t("nav.help"), url: withShopParams("/app/help", searchParams) }]}
    >
      <Layout>
        {/* 1. Operational Summary */}
        <Layout.Section>
          <OperationalSummaryCard stats={stats} loading={statsLoading} />
        </Layout.Section>

        {/* 2. KPIs */}
        <Layout.Section>
          <DashboardKpis stats={stats} loading={statsLoading} period={period} onPeriodChange={setPeriod} />
        </Layout.Section>

        {/* 4. Outcome Breakdown */}
        <Layout.Section>
          <OutcomeBreakdown stats={stats} loading={statsLoading} />
        </Layout.Section>

        {/* 6. Recent Activity Feed */}
        <Layout.Section>
          <RecentActivityFeed stats={stats} loading={statsLoading} />
        </Layout.Section>

        {/* 7. Recent Disputes Table */}
        <Layout.Section>
          <Suspense fallback={<Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>}>
            <RecentDisputesTable />
          </Suspense>
        </Layout.Section>

        {/* Charts */}
        <DashboardCharts stats={stats} loading={statsLoading} />

        <Layout.Section>
          <DashboardHelpCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

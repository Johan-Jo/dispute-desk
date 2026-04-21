/**
 * Merchant dashboard — dispute operations console.
 *
 * Driven by the normalized dispute-history model:
 * normalized_status, submission_state, final_outcome,
 * submitted_at, closed_at, outcome_amount_recovered/lost,
 * last_event_at, needs_attention.
 *
 * Desktop and mobile share state, data fetch, and section order
 * (operational summary → KPIs → outcome breakdown → recent disputes →
 * activity → charts → help). useBreakpoints() inside each extracted
 * sub-component drives the internal layout choices (stacked cards vs.
 * grid, hero KPI tile, etc.).
 */
"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Spinner,
  ProgressBar,
  Box,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { SetupStateResponse } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import { useSearchParams, useRouter } from "next/navigation";
import {
  DEFAULT_STATS,
  safeOutcomeLabel,
  useDateLocale,
  type DashboardStats,
  type PeriodKey,
} from "./dashboardHelpers";
import { DashboardOperationalSummary } from "./DashboardOperationalSummary";
import { DashboardKpis } from "./DashboardKpis";
import { DashboardRecentDisputesPreview } from "./DashboardRecentDisputesPreview";
import { DashboardHelpCard } from "./DashboardHelpCard";

// ─── OutcomeBreakdown ─────────────────────────────────────────────────────

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

// ─── RecentActivityFeed ───────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: "#6B7280",
  in_progress: "#3B82F6",
  needs_review: "#F59E0B",
  ready_to_submit: "#8B5CF6",
  action_needed: "#EF4444",
  submitted: "#06B6D4",
  submitted_to_shopify: "#06B6D4",
  waiting_on_issuer: "#6366F1",
  submitted_to_bank: "#6366F1",
  won: "#10B981",
  lost: "#DC2626",
  accepted_not_contested: "#9CA3AF",
  closed_other: "#9CA3AF",
};

function safeEventLabel(t: ReturnType<typeof useTranslations>, eventType: string): string {
  try {
    const result = t(`eventTypes.${eventType}`);
    if (result.startsWith("disputeTimeline.")) return eventType.replace(/_/g, " ");
    return result;
  } catch {
    return eventType.replace(/_/g, " ");
  }
}

function localizeEventDescription(
  t: ReturnType<typeof useTranslations>,
  eventType: string,
  description: string | null,
): string | null {
  if (!description) return null;

  try {
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
      case "pack_blocked": {
        // Gate emits "Completeness score X% is below threshold Y%" (joined
        // with "; " when multiple reasons). Localize the common case; fall
        // through to the raw description for uncommon gate reasons.
        const m = description.match(/^Completeness score (\d+)% is below threshold (\d+)%$/);
        if (m) return t("eventDescriptions.pack_blocked_score", { score: m[1], threshold: m[2] });
        break;
      }
    }
  } catch {
    /* fall through */
  }

  return description;
}

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
          {stats.recentActivity.slice(0, 10).map((item) => {
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
                href={withShopParams(
                  `/app/disputes/${item.disputeId}`,
                  searchParams ?? new URLSearchParams(),
                )}
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

// ─── Charts ───────────────────────────────────────────────────────────────

function DashboardCharts({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const tPacks = useTranslations("packs");

  const translateCategory = (label: string) => {
    try {
      return tPacks(`disputeTypeLabel.${label}`);
    } catch {
      /* fallback */
    }
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

// ─── Main Page ────────────────────────────────────────────────────────────

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [redirecting, setRedirecting] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URL(window.location.href).searchParams.has("ddredirect");
  });

  useEffect(() => {
    const raw = searchParams.get("ddredirect");
    if (!raw) return;
    let target: string;
    try {
      target = decodeURIComponent(raw);
    } catch {
      target = raw;
    }
    if (!target.startsWith("/") || target.startsWith("//")) {
      setRedirecting(false);
      return;
    }
    const prefix = target.startsWith("/app/") || target === "/app" ? "" : "/app";
    const full = `${prefix}${target}`;
    const carry = new URLSearchParams();
    for (const key of ["host", "shop", "embedded", "locale", "id_token"]) {
      const v = searchParams.get(key);
      if (v) carry.set(key, v);
    }
    const sep = full.includes("?") ? "&" : "?";
    const qs = carry.toString();
    const next = qs ? `${full}${sep}${qs}` : full;
    router.replace(next);
  }, [router, searchParams]);

  useEffect(() => {
    if (redirecting) return;
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SetupStateResponse | null) => {
        if (cancelled) return;
        if (!data || data.allDone) {
          setSetupDone(true);
        } else {
          router.replace(withShopParams("/app/setup", searchParams ?? new URLSearchParams()));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router, searchParams, redirecting]);

  useEffect(() => {
    if (!setupDone) return;
    let cancelled = false;
    setStatsLoading(true);
    fetch(`/api/dashboard/stats?period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, setupDone]);

  if (redirecting || !setupDone) {
    return (
      <Page title="DisputeDesk">
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

  const recentDisputesPreview = (
    <Layout.Section>
      <Suspense fallback={
        <Card>
          <BlockStack gap="400" inlineAlign="center">
            <Spinner size="small" />
          </BlockStack>
        </Card>
      }>
        <DashboardRecentDisputesPreview />
      </Suspense>
    </Layout.Section>
  );

  return (
    <Page
      title={t("dashboard.embeddedPageTitle")}
      subtitle={t("dashboard.embeddedSubtitleNew")}
      secondaryActions={[{ content: t("nav.help"), url: withShopParams("/app/help", searchParams ?? new URLSearchParams()) }]}
    >
      <Layout>
        <Layout.Section>
          <DashboardOperationalSummary stats={stats} loading={statsLoading} />
        </Layout.Section>

        <Layout.Section>
          <DashboardKpis stats={stats} loading={statsLoading} period={period} onPeriodChange={setPeriod} />
        </Layout.Section>

        <Layout.Section>
          <OutcomeBreakdown stats={stats} loading={statsLoading} />
        </Layout.Section>

        {recentDisputesPreview}

        <Layout.Section>
          <RecentActivityFeed stats={stats} loading={statsLoading} />
        </Layout.Section>

        <DashboardCharts stats={stats} loading={statsLoading} />

        <Layout.Section>
          <DashboardHelpCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

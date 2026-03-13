/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/page.tsx (dashboard)
 * Figma Make source: src/app/pages/shopify/shopify-home.tsx
 * Reference: setup banner, overview stats (Total Disputes, Win Rate, Revenue Recovered, Avg. Response Time),
 * period selector, recent disputes list, Win Rate Trend + Dispute Categories charts.
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
  Banner,
  InlineStack,
  Badge,
  Button,
  ButtonGroup,
  Spinner,
  ProgressBar,
  Box,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { SetupChecklistCard } from "@/components/setup/SetupChecklistCard";
import { ConfigGuideCard } from "@/components/setup/ConfigGuideCard";
import type { SetupStateResponse } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import { useSearchParams } from "next/navigation";

type PeriodKey = "24h" | "7d" | "30d" | "all";

interface DisputeRow {
  id: string;
  order: string;
  amount: string;
  reason: string | null;
  status: string | null;
  deadline: string | null;
}

interface DashboardStats {
  totalDisputes: number;
  winRate: number;
  revenueRecovered: string;
  avgResponseTime: string;
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
}

const DEFAULT_STATS: DashboardStats = {
  totalDisputes: 0,
  winRate: 0,
  revenueRecovered: "$0",
  avgResponseTime: "—",
  winRateTrend: [0, 0, 0, 0, 0, 0],
  disputeCategories: [],
};

function DashboardSetupBanner() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setState(data ?? null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading || !state || state.allDone) return null;

  const continueUrl = state.nextStepId
    ? withShopParams(`/app/setup/${state.nextStepId}`, searchParams)
    : "/app/setup/overview";

  return (
    <Banner
      tone="warning"
      title={state.nextStepId ? t("dashboard.resumeSetup") : t("dashboard.completeSetup")}
      action={{ content: t("dashboard.continueSetup"), url: continueUrl }}
    >
      <p>{t("dashboard.completeSetupDesc")}</p>
    </Banner>
  );
}

function RecentDisputesTable() {
  const t = useTranslations();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const shopId = document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1];
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetch(`/api/disputes?shop_id=${shopId}&per_page=5`)
      .then((res) => (res.ok ? res.json() : { disputes: [] }))
      .then((data: { disputes?: Array<{ id: string; order_gid?: string | null; amount?: number | null; currency_code?: string | null; reason?: string | null; status?: string | null; due_at?: string | null }> }) => {
        if (cancelled) return;
        const list = data.disputes ?? [];
        setRows(
          list.map((d) => ({
            id: d.id,
            order: d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—",
            amount: d.amount != null ? `$${Number(d.amount).toFixed(2)}` : "—",
            reason: d.reason ?? null,
            status: d.status ?? null,
            deadline: d.due_at ? new Date(d.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null,
          }))
        );
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
          <Text as="p" variant="bodyMd" tone="subdued">{t("dashboard.noDisputesYetDesc")}</Text>
          <Button url="/app/disputes">{t("dashboard.goToDisputes")}</Button>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
          <Button variant="plain" url="/app/disputes">{t("common.viewAll")}</Button>
        </InlineStack>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--p-color-border)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: "12px" }}>{t("table.id")}</th>
              <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: "12px" }}>{t("table.order")}</th>
              <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: "12px" }}>{t("table.amount")}</th>
              <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: "12px" }}>{t("table.reason")}</th>
              <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: "12px" }}>{t("table.status")}</th>
              <th style={{ padding: "8px 12px", fontWeight: 600, fontSize: "12px" }}>{t("table.deadline")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}>
                <td style={{ padding: "12px" }}>
                  <Link href={`/app/disputes/${r.id}`} style={{ fontWeight: 500, color: "var(--p-color-bg-fill-info)" }}>
                    {r.id}
                  </Link>
                </td>
                <td style={{ padding: "12px" }}>{r.order}</td>
                <td style={{ padding: "12px" }}>{r.amount}</td>
                <td style={{ padding: "12px" }}>{r.reason ?? "—"}</td>
                <td style={{ padding: "12px" }}>{r.status ?? "—"}</td>
                <td style={{ padding: "12px" }}>{r.deadline ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </BlockStack>
    </Card>
  );
}

function DashboardKpis({ period, onPeriodChange, t }: { period: PeriodKey; onPeriodChange: (p: PeriodKey) => void; t: (k: string) => string }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const shopId = document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1];
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetch(`/api/dashboard/stats?shop_id=${shopId}&period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  if (loading) {
    return (
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  const s = stats ?? DEFAULT_STATS;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <Text as="h2" variant="headingMd">{t("dashboard.overview")}</Text>
          <ButtonGroup>
            {(["24h", "7d", "30d", "all"] as const).map((key) => (
              <Button
                key={key}
                variant={period === key ? "primary" : "plain"}
                size="slim"
                onClick={() => onPeriodChange(key)}
              >
                {t(`dashboard.period${key === "all" ? "All" : key}`)}
              </Button>
            ))}
          </ButtonGroup>
        </InlineStack>
        <InlineStack gap="400" wrap>
          <Box minWidth="140px">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.totalDisputes")}</Text>
              <Text as="p" variant="headingXl">{s.totalDisputes}</Text>
            </BlockStack>
          </Box>
          <Box minWidth="140px">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.winRate")}</Text>
              <Text as="p" variant="headingXl">{s.winRate}%</Text>
            </BlockStack>
          </Box>
          <Box minWidth="140px">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.revenueRecovered")}</Text>
              <Text as="p" variant="headingXl">{s.revenueRecovered}</Text>
            </BlockStack>
          </Box>
          <Box minWidth="140px">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.avgResponseTime")}</Text>
              <Text as="p" variant="headingXl">{s.avgResponseTime}</Text>
            </BlockStack>
          </Box>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function DashboardCharts({ period, t }: { period: PeriodKey; t: (k: string) => string }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const shopId = document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1];
    if (!shopId) {
      setLoading(false);
      return;
    }
    fetch(`/api/dashboard/stats?shop_id=${shopId}&period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const s = stats ?? DEFAULT_STATS;

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
                {s.winRateTrend.map((pct, i) => (
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
            ) : s.disputeCategories.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">{t("dashboard.noDisputesYetDesc")}</Text>
            ) : (
              <BlockStack gap="300">
                {s.disputeCategories.map(({ label, value }) => (
                  <BlockStack key={label} gap="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">{label}</Text>
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

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const [period, setPeriod] = useState<PeriodKey>("30d");

  return (
    <Page
      title={t("dashboard.title")}
      subtitle={t("dashboard.embeddedSubtitle")}
      primaryAction={{ content: t("dashboard.automationSettings"), url: "/app/disputes" }}
      secondaryActions={[{ content: t("nav.help"), url: "/app/help" }]}
    >
      <Layout>
        <Layout.Section>
          <DashboardSetupBanner />
        </Layout.Section>

        <Layout.Section>
          <ConfigGuideCard />
        </Layout.Section>
        <Layout.Section>
          <Suspense fallback={<Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>}>
            <SetupChecklistCard />
          </Suspense>
        </Layout.Section>

        {/* Overview: period selector + 4 KPI cards (real data from API) */}
        <Layout.Section>
          <DashboardKpis period={period} onPeriodChange={setPeriod} t={t} />
        </Layout.Section>

        <Layout.Section>
          <Suspense fallback={<Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>}>
            <RecentDisputesTable />
          </Suspense>
        </Layout.Section>

        {/* Win Rate Trend + Dispute Categories (real data from API) */}
        <DashboardCharts period={period} t={t} />
      </Layout>
    </Page>
  );
}

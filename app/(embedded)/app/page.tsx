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
  Icon,
} from "@shopify/polaris";
import {
  AlertCircleIcon,
  ChartLineIcon,
  CashDollarIcon,
  ClockIcon,
} from "@shopify/polaris-icons";
import { useTranslations } from "next-intl";
import { ConfigGuideCard } from "@/components/setup/ConfigGuideCard";
import type { SetupStateResponse } from "@/lib/setup/types";
import { withShopParams } from "@/lib/withShopParams";
import { useSearchParams, useRouter } from "next/navigation";

interface AutomationSettings {
  auto_build_enabled: boolean;
  auto_save_enabled: boolean;
  auto_save_min_score: number;
  enforce_no_blockers: boolean;
}

type PeriodKey = "24h" | "7d" | "30d" | "all";

interface DisputeRow {
  id: string;
  shortId: string;
  order: string;
  orderUrl: string | null;
  customer: string | null;
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
  const router = useRouter();
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/setup/state")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SetupStateResponse | null) => {
        if (!cancelled) {
          setState(data ?? null);
          // First-time install: permissions not yet done → redirect to authorization page
          if (data && data.steps?.permissions?.status === "todo") {
            router.replace("/app/connect");
          }
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [router]);

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

function shopifyOrderUrl(shopDomain: string | null, orderGid: string | null): string | null {
  if (!shopDomain || !orderGid) return null;
  // gid://shopify/Order/1234567890 → numeric id
  const numericId = orderGid.split("/").pop();
  if (!numericId) return null;
  return `https://${shopDomain}/admin/orders/${numericId}`;
}

function RecentDisputesTable() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/disputes?per_page=5").then((r) => (r.ok ? r.json() : { disputes: [] })),
      fetch("/api/billing/usage").then((r) => (r.ok ? r.json() : {})),
    ]).then(([disputeData, usageData]: [
      { disputes?: Array<{ id: string; order_gid?: string | null; order_name?: string | null; customer_display_name?: string | null; amount?: number | null; currency_code?: string | null; reason?: string | null; status?: string | null; due_at?: string | null }> },
      { shop_domain?: string | null }
    ]) => {
        if (cancelled) return;
        const shopDomain = usageData.shop_domain ?? null;
        const list = disputeData.disputes ?? [];
        setRows(
          list.map((d) => ({
            id: d.id,
            shortId: d.id.slice(0, 8).toUpperCase(),
            order: d.order_name ?? (d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—"),
            orderUrl: shopifyOrderUrl(shopDomain, d.order_gid ?? null),
            customer: d.customer_display_name ?? null,
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

  const statusBadge = (status: string | null) => {
    if (!status) return <Badge>{t("disputes.statusUnknown")}</Badge>;
    switch (status) {
      case "needs_response": return <Badge tone="warning">{t("disputes.statusNeedsResponse")}</Badge>;
      case "under_review":   return <Badge tone="info">{t("disputes.statusUnderReview")}</Badge>;
      case "charge_refunded":
      case "won":            return <Badge tone="success">{t("disputes.statusWon")}</Badge>;
      case "lost":           return <Badge tone="critical">{t("disputes.statusLost")}</Badge>;
      default:               return <Badge>{status.replace(/_/g, " ")}</Badge>;
    }
  };

  const formatReason = (reason: string | null) => {
    if (!reason) return "—";
    return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const thStyle: React.CSSProperties = {
    padding: "10px 16px",
    fontWeight: 600,
    fontSize: "12px",
    color: "var(--p-color-text-secondary)",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = { padding: "14px 16px", verticalAlign: "middle" };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{t("dashboard.recentDisputes")}</Text>
          <Button variant="plain" url="/app/disputes">{t("common.viewAll")}</Button>
        </InlineStack>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--p-color-border)" }}>
                <th style={thStyle}>{t("table.order")}</th>
                <th style={thStyle}>{t("table.id")}</th>
                <th style={thStyle}>{t("table.customer")}</th>
                <th style={thStyle}>{t("table.amount")}</th>
                <th style={thStyle}>{t("table.reason")}</th>
                <th style={thStyle}>{t("table.status")}</th>
                <th style={thStyle}>{t("table.deadline")}</th>
                <th style={thStyle}>{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}
                >
                  <td style={tdStyle}>
                    {r.orderUrl ? (
                      <a
                        href={r.orderUrl}
                        target="_top"
                        rel="noopener noreferrer"
                        style={{ fontWeight: 600, color: "#4F46E5", textDecoration: "none" }}
                      >
                        {r.order}
                      </a>
                    ) : (
                      <Text as="span" variant="bodySm" fontWeight="semibold">{r.order}</Text>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{r.shortId}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Text as="span" variant="bodySm" tone={r.customer ? undefined : "subdued"}>
                      {r.customer ?? "—"}
                    </Text>
                  </td>
                  <td style={tdStyle}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{r.amount}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatReason(r.reason)}</Text>
                  </td>
                  <td style={tdStyle}>{statusBadge(r.status)}</td>
                  <td style={tdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{r.deadline ?? "—"}</Text>
                  </td>
                  <td style={tdStyle}>
                    <Link
                      href={withShopParams(`/app/disputes/${r.id}`, searchParams)}
                      style={{ color: "#4F46E5", fontSize: "13px", textDecoration: "none", whiteSpace: "nowrap" }}
                    >
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

function DashboardKpis({ period, onPeriodChange }: { period: PeriodKey; onPeriodChange: (p: PeriodKey) => void }) {
  const t = useTranslations();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/stats?period=${period}`)
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

  const periodLabel = (key: PeriodKey) =>
    t(`dashboard.period${key === "all" ? "All" : key}`);

  const kpiCards = [
    {
      icon: AlertCircleIcon,
      label: t("dashboard.totalDisputes"),
      value: String(s.totalDisputes),
      period: periodLabel(period),
    },
    {
      icon: ChartLineIcon,
      label: t("dashboard.winRate"),
      value: `${s.winRate}%`,
      period: periodLabel(period),
    },
    {
      icon: CashDollarIcon,
      label: t("dashboard.revenueRecovered"),
      value: s.revenueRecovered,
      period: periodLabel(period),
    },
    {
      icon: ClockIcon,
      label: t("dashboard.avgResponseTime"),
      value: s.avgResponseTime,
      period: periodLabel(period),
    },
  ];

  return (
    <BlockStack gap="300">
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
        {kpiCards.map((card) => (
          <div
            key={card.label}
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #E5E7EB",
              padding: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <div style={{ color: "#667085" }}>
                <Icon source={card.icon} tone="subdued" />
              </div>
              <p style={{ fontSize: "12px", color: "#667085", margin: 0 }}>{card.label}</p>
            </div>
            <p style={{ fontSize: "24px", fontWeight: 700, color: "#0B1220", margin: 0 }}>{loading ? "—" : card.value}</p>
            <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "4px" }}>{card.period}</p>
          </div>
        ))}
      </div>
    </BlockStack>
  );
}

function DashboardCharts({ period }: { period: PeriodKey }) {
  const t = useTranslations();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/stats?period=${period}`)
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

function AutomationStatusCard() {
  const t = useTranslations("dashboard");
  const [settings, setSettings] = useState<AutomationSettings | null>(null);

  useEffect(() => {
    fetch("/api/automation/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setSettings(data); });
  }, []);

  if (!settings) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">{t("automationStatus")}</Text>
          <Button variant="plain" size="slim" url="/app/settings">{t("settings")}</Button>
        </InlineStack>
        <InlineStack gap="400" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">{t("autoBuild")}</Text>
            {settings.auto_build_enabled
              ? <Badge tone="success">ON</Badge>
              : <Badge>OFF</Badge>}
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">{t("autoSave")}</Text>
            {settings.auto_save_enabled
              ? <Badge tone="success">ON</Badge>
              : <Badge>OFF</Badge>}
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">{t("minScore")}</Text>
            <Text as="span" variant="bodySm" fontWeight="semibold">{settings.auto_save_min_score}%</Text>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">{t("blockerGate")}</Text>
            {settings.enforce_no_blockers
              ? <Badge tone="success">ON</Badge>
              : <Badge>OFF</Badge>}
          </InlineStack>
        </InlineStack>
        <div
          style={{
            background: "#F6F6F7",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 13,
            color: "#6D7175",
            lineHeight: 1.5,
          }}
        >
          {t("automationBanner")}
        </div>
      </BlockStack>
    </Card>
  );
}

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const [period, setPeriod] = useState<PeriodKey>("30d");

  return (
    <Page
      title={t("dashboard.title")}
      subtitle={t("dashboard.embeddedSubtitle")}
      primaryAction={{ content: t("dashboard.automationSettings"), url: "/app/settings" }}
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
          <AutomationStatusCard />
        </Layout.Section>

        {/* Overview: period selector + 4 KPI cards (real data from API) */}
        <Layout.Section>
          <DashboardKpis period={period} onPeriodChange={setPeriod} />
        </Layout.Section>

        <Layout.Section>
          <Suspense fallback={<Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>}>
            <RecentDisputesTable />
          </Suspense>
        </Layout.Section>

        {/* Win Rate Trend + Dispute Categories (real data from API) */}
        <DashboardCharts period={period} />
      </Layout>
    </Page>
  );
}

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
  PackageIcon,
  QuestionCircleIcon,
  ShieldCheckMarkIcon,
} from "@shopify/polaris-icons";
import { useTranslations } from "next-intl";
import { ConfigGuideCard } from "@/components/setup/ConfigGuideCard";
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
import { deriveCoverage, type CoverageSummary } from "@/lib/coverage/deriveCoverage";

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
  // Portal-matching KPIs
  activeDisputes: number;
  winRate: number;
  packCount: number;
  amountAtRisk: number;
  // Period-over-period changes (null = no comparison available)
  activeDisputesChange: number | null;
  winRateChange: number | null;
  amountAtRiskChange: number | null;
  // Chart fields
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
}

const DEFAULT_STATS: DashboardStats = {
  activeDisputes: 0,
  winRate: 0,
  packCount: 0,
  amountAtRisk: 0,
  activeDisputesChange: null,
  winRateChange: null,
  amountAtRiskChange: null,
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
          // First-time install: connection not yet done → redirect to authorization page
          if (data && data.steps?.connection?.status === "todo") {
            router.replace(withShopParams("/app/setup", searchParams));
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
            orderUrl: shopifyOrderAdminUrl(shopDomain, d.order_gid ?? null),
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
          <Button url={withShopParams("/app/disputes", searchParams)}>{t("dashboard.goToDisputes")}</Button>
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
                <th style={recentDisputesThStyle}>{t("table.id")}</th>
                <th style={recentDisputesThStyle}>{t("table.customer")}</th>
                <th style={recentDisputesThStyle}>{t("table.amount")}</th>
                <th style={recentDisputesThStyle}>{t("table.reason")}</th>
                <th style={recentDisputesThStyle}>{t("table.status")}</th>
                <th style={recentDisputesThStyle}>{t("table.deadline")}</th>
                <th style={recentDisputesThStyle}>{t("table.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--p-color-border-subdued)" }}
                >
                  <td style={recentDisputesTdStyle}>
                    {r.orderUrl ? (
                      <a
                        href={r.orderUrl}
                        target="_top"
                        rel="noopener noreferrer"
                        style={recentDisputesOrderLinkStyle}
                      >
                        {r.order}
                      </a>
                    ) : (
                      <Text as="span" variant="bodySm" fontWeight="semibold">{r.order}</Text>
                    )}
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{r.shortId}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone={r.customer ? undefined : "subdued"}>
                      {r.customer ?? "—"}
                    </Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" fontWeight="semibold">{r.amount}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{formatReason(r.reason)}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>{statusBadge(r.status)}</td>
                  <td style={recentDisputesTdStyle}>
                    <Text as="span" variant="bodySm" tone="subdued">{r.deadline ?? "—"}</Text>
                  </td>
                  <td style={recentDisputesTdStyle}>
                    <Link
                      href={withShopParams(`/app/disputes/${r.id}`, searchParams)}
                      style={recentDisputesViewDetailsLinkStyle}
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

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);

  const kpiCards = [
    {
      icon: AlertCircleIcon,
      label: t("dashboard.activeDisputes"),
      value: String(s.activeDisputes),
      change: s.activeDisputesChange,
    },
    {
      icon: ChartLineIcon,
      label: t("dashboard.winRate"),
      value: `${s.winRate}%`,
      change: s.winRateChange,
    },
    {
      icon: PackageIcon,
      label: t("dashboard.activePlaybooks"),
      value: String(s.packCount),
      change: null as number | null,
    },
    {
      icon: CashDollarIcon,
      label: t("dashboard.amountAtRisk"),
      value: formatCurrency(s.amountAtRisk),
      change: s.amountAtRiskChange,
    },
  ];

  const periodLabel = (key: PeriodKey) =>
    t(`dashboard.period${key === "all" ? "All" : key}`);

  return (
    <div style={{
      background: "#fff",
      borderRadius: "12px",
      border: "1px solid #E5E7EB",
      padding: "20px",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
        <Text as="h2" variant="headingMd">{t("dashboard.overview")}</Text>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {(["24h", "7d", "30d", "all"] as const).map((key) => (
            <button
              key={key}
              onClick={() => onPeriodChange(key)}
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
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
        {kpiCards.map((card) => {
          const hasChange = card.change !== null && card.change !== undefined;
          const isPositive = (card.change ?? 0) > 0;
          const isNegative = (card.change ?? 0) < 0;
          return (
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
              <p style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>{loading ? "—" : card.value}</p>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
                {hasChange && !loading ? (
                  <>
                    <span style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: isPositive ? "#10B981" : isNegative ? "#EF4444" : "#9CA3AF",
                    }}>
                      {isPositive ? "↗" : isNegative ? "↘" : ""} {isPositive ? "+" : ""}{card.change}%
                    </span>
                    <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{t("dashboard.vsLastMonth")}</span>
                  </>
                ) : (
                  <>
                    <div style={{ flex: 1, height: "2px", background: "#7C3AED", borderRadius: "1px" }} />
                    <p style={{ fontSize: "12px", color: "#9CA3AF", margin: 0 }}>{periodLabel(period)}</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

function ProtectionStatusCard() {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/rules").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/packs?status=ACTIVE").then((r) => (r.ok ? r.json() : { packs: [] })),
      fetch("/api/automation/settings").then((r) => (r.ok ? r.json() : null)),
    ]).then(([rulesData, packsData, autoData]) => {
      if (cancelled) return;
      const rules = Array.isArray(rulesData) ? rulesData : [];
      const packs = packsData?.packs ?? [];
      setCoverage(deriveCoverage(rules, packs));
      if (autoData) setSettings(autoData);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  const c = coverage;
  const isProtected = c && c.coveredCount > 0 && settings?.auto_build_enabled;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: isProtected ? "#DCFCE7" : "#FEF3C7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: isProtected ? "#16A34A" : "#D97706",
              }}
            >
              <Icon source={ShieldCheckMarkIcon} />
            </div>
            <Text as="h2" variant="headingMd">{t("protectionStatus")}</Text>
          </InlineStack>
          <Button variant="plain" size="slim" url={withShopParams("/app/coverage", searchParams)}>
            {t("viewCoverage")}
          </Button>
        </InlineStack>

        <Text as="p" variant="bodyMd" fontWeight="semibold" tone={isProtected ? "success" : "caution"}>
          {isProtected ? t("protectionActive") : t("protectionInactive")}
        </Text>

        {c && (
          <InlineStack gap="400" wrap>
            <Text as="span" variant="bodySm" tone="subdued">
              {t("familiesCovered", { covered: c.coveredCount, total: c.totalFamilies })}
            </Text>
            {c.automatedCount > 0 && (
              <Badge tone="success">{t("familiesAutomated", { count: c.automatedCount })}</Badge>
            )}
            {c.reviewFirstCount > 0 && (
              <Badge tone="info">{t("familiesReviewFirst", { count: c.reviewFirstCount })}</Badge>
            )}
          </InlineStack>
        )}

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

function DashboardHelpCard() {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  return (
    <Card>
      <InlineStack gap="400" blockAlign="center" wrap={false}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "#EDE9FE",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "#7C3AED",
          }}
        >
          <Icon source={QuestionCircleIcon} />
        </div>
        <BlockStack gap="050">
          <Text as="h3" variant="headingSm">{t("helpCardTitle")}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{t("helpCardDesc")}</Text>
        </BlockStack>
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <Button
            variant="plain"
            url={withShopParams("/app/help/understanding-dashboard", searchParams)}
          >
            {t("helpCardLink")}
          </Button>
        </div>
      </InlineStack>
    </Card>
  );
}

export default function EmbeddedDashboardPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<PeriodKey>("30d");

  return (
    <Page
      title={t("dashboard.embeddedPageTitle")}
      subtitle={t("dashboard.embeddedSubtitle")}
      primaryAction={{ content: t("dashboard.viewCoverage"), url: withShopParams("/app/coverage", searchParams) }}
      secondaryActions={[{ content: t("nav.help"), url: withShopParams("/app/help", searchParams) }]}
    >
      <Layout>
        <Layout.Section>
          <DashboardSetupBanner />
        </Layout.Section>

        {/* TEMPORARY: quick link to test the setup wizard */}
        <Layout.Section>
          <Banner title="Dev: Test Setup Wizard" tone="info">
            <ButtonGroup>
              <Button url={withShopParams("/app/setup", searchParams)} variant="primary">Step 0: Welcome</Button>
              <Button url={withShopParams("/app/setup/connection", searchParams)}>Step 1: Connection</Button>
              <Button url={withShopParams("/app/setup/store_profile", searchParams)}>Step 2: Store Profile</Button>
              <Button url={withShopParams("/app/setup/coverage", searchParams)}>Step 3: Coverage</Button>
              <Button url={withShopParams("/app/setup/automation", searchParams)}>Step 4: Automation</Button>
              <Button url={withShopParams("/app/setup/activate", searchParams)}>Step 5: Activate</Button>
            </ButtonGroup>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <ConfigGuideCard />
        </Layout.Section>

        <Layout.Section>
          <ProtectionStatusCard />
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

        <Layout.Section>
          <DashboardHelpCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

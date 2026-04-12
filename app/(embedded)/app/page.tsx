/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/page.tsx (dashboard)
 * Figma Make source: src/app/pages/shopify/shopify-home.tsx
 * Reference: setup banner, overview stats (Total Disputes, Win Rate, Revenue Recovered, Avg. Response Time),
 * period selector, recent disputes list, Win Rate Trend + Dispute Categories charts.
 */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { deriveLifecycleCoverage, type LifecycleCoverageSummary } from "@/lib/coverage/deriveLifecycleCoverage";
import { phaseBadgeTone, phaseLabel } from "@/lib/disputes/phaseUtils";

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
  phase: string | null;
  status: string | null;
  deadline: string | null;
}

interface DashboardStats {
  // Portal-matching KPIs
  activeDisputes: number;
  winRate: number;
  packCount: number;
  amountAtRisk: number;
  currencyCode: string;
  // Period-over-period changes (null = no comparison available)
  activeDisputesChange: number | null;
  winRateChange: number | null;
  amountAtRiskChange: number | null;
  // Lifecycle phase counts
  inquiryCount: number;
  chargebackCount: number;
  unknownPhaseCount: number;
  needsAttentionCount: number;
  // Chart fields
  winRateTrend: number[];
  disputeCategories: { label: string; value: number }[];
}

const DEFAULT_STATS: DashboardStats = {
  activeDisputes: 0,
  winRate: 0,
  packCount: 0,
  amountAtRisk: 0,
  currencyCode: "USD",
  activeDisputesChange: null,
  winRateChange: null,
  amountAtRiskChange: null,
  inquiryCount: 0,
  chargebackCount: 0,
  unknownPhaseCount: 0,
  needsAttentionCount: 0,
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
  const tPacks = useTranslations("packs");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const dateLocale = useMemo(() => {
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("de")) return "de-DE";
    if (locale.startsWith("sv")) return "sv-SE";
    if (locale.startsWith("es")) return "es-ES";
    if (locale.startsWith("fr")) return "fr-FR";
    return "en-US";
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/disputes?per_page=5").then((r) => (r.ok ? r.json() : { disputes: [] })),
      fetch("/api/billing/usage").then((r) => (r.ok ? r.json() : {})),
    ]).then(([disputeData, usageData]: [
      { disputes?: Array<{ id: string; order_gid?: string | null; order_name?: string | null; customer_display_name?: string | null; amount?: number | null; currency_code?: string | null; reason?: string | null; phase?: string | null; status?: string | null; due_at?: string | null }> },
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
            amount: d.amount != null
              ? new Intl.NumberFormat(dateLocale, { style: "currency", currency: d.currency_code ?? "USD" }).format(Number(d.amount))
              : "—",
            reason: d.reason ?? null,
            phase: d.phase ?? null,
            status: d.status ?? null,
            deadline: d.due_at ? new Date(d.due_at).toLocaleDateString(dateLocale, { month: "short", day: "numeric" }) : null,
          }))
        );
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateLocale]);

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
    try { return tPacks(`disputeTypeLabel.${reason}`); } catch { /* fallback */ }
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
                <th style={recentDisputesThStyle}>{t("disputes.phaseLabel")}</th>
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
                  <td style={recentDisputesTdStyle}>
                    <Badge tone={phaseBadgeTone(r.phase as "inquiry" | "chargeback" | null)}>
                      {phaseLabel(r.phase as "inquiry" | "chargeback" | null, t)}
                    </Badge>
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

function DashboardKpis({ stats, loading, period, onPeriodChange }: { stats: DashboardStats; loading: boolean; period: PeriodKey; onPeriodChange: (p: PeriodKey) => void }) {
  const t = useTranslations();
  const locale = useLocale();

  const dateLocale = useMemo(() => {
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("de")) return "de-DE";
    if (locale.startsWith("sv")) return "sv-SE";
    if (locale.startsWith("es")) return "es-ES";
    if (locale.startsWith("fr")) return "fr-FR";
    return "en-US";
  }, [locale]);

  const s = stats;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(dateLocale, { style: "currency", currency: s.currencyCode, maximumFractionDigits: 0 }).format(amount);

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
        <Text as="h2" variant="headingMd">{t("dashboard.performanceOverview")}</Text>
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

function DashboardCharts({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const tPacks = useTranslations("packs");

  const s = stats;

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

function ProtectionStatusCard() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("coverage");
  const searchParams = useSearchParams();
  const [lifecycle, setLifecycle] = useState<LifecycleCoverageSummary | null>(null);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/rules").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/packs?status=ACTIVE").then((r) => (r.ok ? r.json() : { packs: [] })),
      fetch("/api/automation/settings").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/reason-mappings").then((r) => (r.ok ? r.json() : { mappings: [] })),
    ]).then(([rulesData, packsData, autoData, mappingsData]) => {
      if (cancelled) return;
      const rules = Array.isArray(rulesData) ? rulesData : [];
      const packs = packsData?.packs ?? [];
      const mappings = mappingsData?.mappings ?? [];
      setLifecycle(deriveLifecycleCoverage(rules, packs, mappings));
      if (autoData) setSettings(autoData);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;

  const lc = lifecycle;

  // Build specific gap descriptions
  const gaps: { family: string; type: "both" | "inquiry" | "chargeback" }[] = [];
  if (lc) {
    for (const f of lc.families) {
      const iGap = f.inquiry.hasGap;
      const cGap = f.chargeback.hasGap;
      if (iGap && cGap) {
        gaps.push({ family: tc(f.labelKey.replace("coverage.", "")), type: "both" });
      } else if (iGap) {
        gaps.push({ family: tc(f.labelKey.replace("coverage.", "")), type: "inquiry" });
      } else if (cGap) {
        gaps.push({ family: tc(f.labelKey.replace("coverage.", "")), type: "chargeback" });
      }
    }
  }

  // Strict status taxonomy
  type ProtectionStatus = "active" | "partial" | "attention" | "setup";
  let status: ProtectionStatus = "setup";

  if (lc) {
    const hasAutoBuild = settings?.auto_build_enabled ?? false;
    if (lc.fullyConfiguredCount === lc.totalFamilies && hasAutoBuild) {
      status = "active";
    } else if (lc.fullyConfiguredCount > 0 || gaps.length < lc.totalFamilies) {
      status = gaps.length > 0 ? "attention" : "partial";
    } else {
      status = "setup";
    }
    if (!hasAutoBuild && status === "active") status = "attention";
  }

  const statusConfig = {
    active: { label: t("statusActive"), tone: "success" as const, bg: "#DCFCE7", color: "#16A34A" },
    partial: { label: t("statusPartial"), tone: "warning" as const, bg: "#FEF3C7", color: "#D97706" },
    attention: { label: t("statusAttention"), tone: "critical" as const, bg: "#FEE2E2", color: "#DC2626" },
    setup: { label: t("statusSetup"), tone: "critical" as const, bg: "#FEE2E2", color: "#DC2626" },
  };

  const cfg = statusConfig[status];

  // Recommended action
  let ctaContent = t("viewCasesAction");
  let ctaUrl = withShopParams("/app/disputes", searchParams);
  if (status === "setup") {
    ctaContent = t("continueSetupAction");
    ctaUrl = withShopParams("/app/setup", searchParams);
  } else if (gaps.length > 0) {
    ctaContent = t("reviewCoverageGaps");
    ctaUrl = withShopParams("/app/coverage", searchParams);
  }

  return (
    <Card>
      <BlockStack gap="300">
        {/* Status header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: cfg.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: cfg.color,
              }}
            >
              <Icon source={ShieldCheckMarkIcon} />
            </div>
            <Text as="h2" variant="headingMd">{t("protectionSummary")}</Text>
          </InlineStack>
          <Badge tone={cfg.tone}>{cfg.label}</Badge>
        </InlineStack>

        {/* Specific gaps or all clear */}
        {gaps.length > 0 ? (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">{t("coverageGapsTitle")}</Text>
            {gaps.map((g) => (
              <InlineStack key={g.family + g.type} gap="200" blockAlign="center">
                <div style={{ width: 6, height: 6, borderRadius: 3, background: "#EF4444", flexShrink: 0 }} />
                <Text as="span" variant="bodySm">
                  {g.type === "both"
                    ? t("gapBothPhases", { family: g.family })
                    : g.type === "inquiry"
                      ? t("gapInquiryOnly", { family: g.family })
                      : t("gapChargebackOnly", { family: g.family })}
                </Text>
              </InlineStack>
            ))}
          </BlockStack>
        ) : (
          <Text as="p" variant="bodySm" tone="success">{t("noBlockers")}</Text>
        )}

        {!settings?.auto_build_enabled && status !== "setup" && (
          <InlineStack gap="200" blockAlign="center">
            <div style={{ width: 6, height: 6, borderRadius: 3, background: "#F59E0B", flexShrink: 0 }} />
            <Text as="span" variant="bodySm" tone="caution">{t("autoBuildDisabled")}</Text>
          </InlineStack>
        )}

        {/* Recommended next action */}
        <InlineStack gap="200">
          <Button variant="primary" size="slim" url={ctaUrl}>
            {ctaContent}
          </Button>
          <Button variant="plain" size="slim" url={withShopParams("/app/coverage", searchParams)}>
            {t("openCoverage")}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function LifecycleQueueSummary({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  const t = useTranslations();
  const searchParams = useSearchParams();

  if (loading) return null;

  const s = stats;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
      {/* Open Inquiries */}
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="info">{t("disputes.inquiryBadge")}</Badge>
            <Text as="h3" variant="headingSm">{t("dashboard.openInquiries")}</Text>
          </InlineStack>
          <Text as="p" variant="headingLg">{s.inquiryCount}</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {s.inquiryCount === 0 ? t("dashboard.noOpenInquiries") : `${s.inquiryCount} ${t("dashboard.openInquiries").toLowerCase()}`}
          </Text>
          {s.inquiryCount > 0 && (
            <Button variant="plain" url={withShopParams("/app/disputes?phase=inquiry", searchParams)} size="slim">
              {t("common.viewAll")}
            </Button>
          )}
        </BlockStack>
      </Card>
      {/* Open Chargebacks */}
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone="warning">{t("disputes.chargebackBadge")}</Badge>
            <Text as="h3" variant="headingSm">{t("dashboard.openChargebacks")}</Text>
          </InlineStack>
          <Text as="p" variant="headingLg">{s.chargebackCount}</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {s.chargebackCount === 0 ? t("dashboard.noOpenChargebacks") : `${s.chargebackCount} ${t("dashboard.openChargebacks").toLowerCase()}`}
          </Text>
          {s.chargebackCount > 0 && (
            <Button variant="plain" url={withShopParams("/app/disputes?phase=chargeback", searchParams)} size="slim">
              {t("common.viewAll")}
            </Button>
          )}
        </BlockStack>
      </Card>
      {/* Cases needing review */}
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={s.needsAttentionCount > 0 ? "critical" : undefined}>
              {t("dashboard.casesNeedingReview")}
            </Badge>
          </InlineStack>
          <Text as="p" variant="headingLg">{s.needsAttentionCount}</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {s.needsAttentionCount > 0
              ? t("dashboard.casesAwaitingReview", { count: s.needsAttentionCount })
              : t("dashboard.noCasesNeedReview")}
          </Text>
          {s.needsAttentionCount > 0 && (
            <Button variant="plain" url={withShopParams("/app/disputes?needs_review=true", searchParams)} size="slim">
              {t("common.viewAll")}
            </Button>
          )}
        </BlockStack>
      </Card>
    </div>
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
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    fetch(`/api/dashboard/stats?period=${period}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  return (
    <Page
      title={t("dashboard.embeddedPageTitle")}
      subtitle={t("dashboard.embeddedSubtitle")}
      primaryAction={{ content: t("dashboard.viewCoverage"), url: withShopParams("/app/coverage", searchParams) }}
      secondaryActions={[{ content: t("nav.help"), url: withShopParams("/app/help", searchParams) }]}
    >
      <Layout>
        {/* 1. Setup banner — only if setup incomplete */}
        <Layout.Section>
          <DashboardSetupBanner />
        </Layout.Section>

        {/* 2. Protection Status — THE FIRST THING merchants see */}
        <Layout.Section>
          <ProtectionStatusCard />
        </Layout.Section>

        {/* 3. Active Cases — inquiry/chargeback split */}
        <Layout.Section>
          <LifecycleQueueSummary stats={stats} loading={statsLoading} />
        </Layout.Section>

        {/* 4. Advanced: KPI cards */}
        <Layout.Section>
          <DashboardKpis stats={stats} loading={statsLoading} period={period} onPeriodChange={setPeriod} />
        </Layout.Section>

        {/* 5. Advanced: Recent disputes table */}
        <Layout.Section>
          <Suspense fallback={<Card><BlockStack gap="400" inlineAlign="center"><Spinner size="small" /></BlockStack></Card>}>
            <RecentDisputesTable />
          </Suspense>
        </Layout.Section>

        {/* 6. Advanced: Charts */}
        <DashboardCharts stats={stats} loading={statsLoading} />

        <Layout.Section>
          <DashboardHelpCard />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/**
 * Embedded disputes list — Polaris Page/Layout/Card shell.
 * Desktop: Figma-matched HTML table (DesktopDisputesTable).
 * Mobile (smDown): triage-first stacked cards (MobileDisputesList) with a
 * Filter + Sort actions bar. Branching driven by Polaris useBreakpoints().
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  Popover,
  ChoiceList,
  Box,
  Spinner,
  InlineStack,
  Pagination,
  Icon,
  BlockStack,
  Banner,
  Text,
  Select,
  useBreakpoints,
} from "@shopify/polaris";
import {
  SearchIcon,
  FilterIcon,
  ExportIcon,
  SortIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import styles from "./disputes-list.module.css";
import { DesktopDisputesTable } from "./DesktopDisputesTable";
import { MobileDisputesList } from "./MobileDisputesList";
import {
  figmaKpis,
  formatCurrency,
  formatDueDate,
  formatShortId,
  orderLabel,
  resolveSort,
  statusLabelForCsv,
  translateFamily,
  translateReason,
  type Dispute,
  type SortMode,
  type TabId,
} from "./disputeListHelpers";

interface DisputesResponse {
  disputes: Dispute[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

/** Figma KPI card (page-level, top of the list). Pure presentational. */
function KpiCard({
  label,
  value,
  subtitle,
  subtitleColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  subtitleColor?: string;
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #C9CCCF",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#6D7175",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: "#202223",
          marginBottom: subtitle ? 4 : 0,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: subtitleColor ?? "#6D7175",
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

export default function DisputesListPage() {
  const searchParams = useSearchParams();
  const t = useTranslations();
  const locale = useLocale();
  const { smDown } = useBreakpoints();

  const dateLocale = useMemo(() => {
    if (locale.startsWith("pt")) return "pt-BR";
    if (locale.startsWith("de")) return "de-DE";
    if (locale.startsWith("sv")) return "sv-SE";
    if (locale.startsWith("es")) return "es-ES";
    if (locale.startsWith("fr")) return "fr-FR";
    return "en-US";
  }, [locale]);

  const numberLocale = dateLocale;

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [normalizedStatusFilter, setNormalizedStatusFilter] = useState<string[]>([]);
  const [outcomeFilter, setOutcomeFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("active");
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);
  const [sortPopoverActive, setSortPopoverActive] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [hasAlertEmail, setHasAlertEmail] = useState(true);
  /** Quick-preset status dropdown — "All status / Action needed /
   *  Needs review / Under review / Submitted / Closed". Maps onto
   *  `normalizedStatusFilter` and `activeTab`. The detailed Filter
   *  popover stays for power users. */
  const [statusDropdown, setStatusDropdown] = useState<string>("all");

  const applyStatusDropdown = useCallback((value: string) => {
    setStatusDropdown(value);
    setPage(1);
    if (value === "all") {
      setNormalizedStatusFilter([]);
      setActiveTab("active");
      return;
    }
    if (value === "closed") {
      setNormalizedStatusFilter([]);
      setActiveTab("closed");
      return;
    }
    setActiveTab("active");
    if (value === "action_needed") {
      setNormalizedStatusFilter([
        "action_needed",
        "ready_to_submit",
        "new",
        "in_progress",
      ]);
      return;
    }
    if (value === "needs_review") {
      setNormalizedStatusFilter(["needs_review"]);
      return;
    }
    if (value === "under_review") {
      setNormalizedStatusFilter([
        "submitted_to_shopify",
        "submitted_to_bank",
        "waiting_on_issuer",
        "submitted",
      ]);
      return;
    }
    if (value === "submitted") {
      setNormalizedStatusFilter(["submitted_to_shopify", "submitted_to_bank"]);
      return;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shop/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setHasAlertEmail(Boolean(data?.teamEmail));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: "25",
      });
      if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
      if (phaseFilter.length === 1) params.set("phase", phaseFilter[0]);
      if (normalizedStatusFilter.length > 0)
        params.set("normalized_status", normalizedStatusFilter.join(","));
      if (outcomeFilter.length > 0) params.set("final_outcome", outcomeFilter.join(","));
      if (activeTab === "active") {
        params.set("closed", "false");
      } else if (activeTab === "closed") {
        params.set("closed", "true");
      }
      const { sort, sort_dir } = resolveSort(sortMode, activeTab);
      params.set("sort", sort);
      params.set("sort_dir", sort_dir);
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, phaseFilter, normalizedStatusFilter, outcomeFilter, activeTab, sortMode]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  // Reset sortMode to default when switching tabs so each tab gets its natural ordering
  useEffect(() => {
    setSortMode("default");
  }, [activeTab]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/disputes/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchDisputes();
    setSyncing(false);
  };

  const visibleDisputes = queryValue
    ? disputes.filter((d) => {
        const q = queryValue.toLowerCase();
        const short = formatShortId(d.id).toLowerCase();
        return (
          d.dispute_gid.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          short.includes(q) ||
          (d.reason ?? "").toLowerCase().includes(q) ||
          (d.order_gid ?? "").toLowerCase().includes(q) ||
          (d.order_name ?? "").toLowerCase().includes(q) ||
          (d.customer_display_name ?? "").toLowerCase().includes(q)
        );
      })
    : disputes;

  const exportCsv = () => {
    const esc = (v: string) => (v.includes(",") ? `"${v}"` : v);
    const rows = visibleDisputes.map((d) =>
      [
        esc(orderLabel(d)),
        formatShortId(d.id),
        esc(d.customer_display_name ?? ""),
        formatCurrency(d.amount, d.currency_code, numberLocale),
        esc(translateReason(d.reason, t)),
        esc(translateFamily(d.reason, t)),
        d.phase ?? "",
        statusLabelForCsv(d.status, t),
        d.normalized_status ?? "",
        d.submission_state ?? "",
        formatDueDate(d.due_at, dateLocale),
        formatDueDate(d.submitted_at ?? null, dateLocale),
        formatDueDate(d.closed_at ?? null, dateLocale),
        d.final_outcome ?? "",
        d.outcome_amount_recovered != null ? String(d.outcome_amount_recovered) : "",
        d.outcome_amount_lost != null ? String(d.outcome_amount_lost) : "",
        formatDueDate(d.last_event_at ?? null, dateLocale),
      ].join(","),
    );
    const csvHeader = [
      t("disputes.csvOrder"), t("disputes.csvId"), t("disputes.csvCustomer"),
      t("disputes.csvAmount"), t("disputes.csvReason"), t("disputes.csvFamily"),
      t("disputes.csvPhase"), t("disputes.csvStatus"),
      t("disputes.csvNormalizedStatus"), t("disputes.csvSubmissionState"),
      t("disputes.csvDueDate"), t("disputes.csvSubmittedAt"), t("disputes.csvClosedAt"),
      t("disputes.csvOutcome"), t("disputes.csvRecovered"), t("disputes.csvLost"),
      t("disputes.csvLastEvent"),
    ].join(",");
    const csv = [csvHeader, ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "disputes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // KPIs for the Figma 4-card row + red urgent banner.
  const kpis = useMemo(() => figmaKpis(disputes), [disputes]);

  /** Find the first urgent dispute's id so the "Resolve now" button on
   *  the red banner can deep-link the merchant straight to the most
   *  pressing case. Falls back to navigating to the filtered list. */
  const firstUrgent = useMemo(() => {
    const urgent = disputes
      .filter((d) => {
        if (!d.due_at) return false;
        if (d.closed_at) return false;
        const h = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
        return h <= 48;
      })
      .sort(
        (a, b) =>
          new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime(),
      );
    return urgent[0] ?? null;
  }, [disputes]);

  const sortChoices = useMemo(() => {
    const base = [
      { label: t("disputes.sortUrgency"), value: "urgency" },
      { label: t("disputes.sortAmount"), value: "amount" },
      { label: t("disputes.sortNewest"), value: "newest" },
    ];
    if (activeTab === "closed") {
      base.push({ label: t("disputes.sortClosedRecent"), value: "closed_desc" });
    }
    return base;
  }, [activeTab, t]);

  const effectiveSortValue = sortMode === "default"
    ? (activeTab === "closed" ? "closed_desc" : "urgency")
    : sortMode;

  const filterPopover = (
    <Popover
      active={filterPopoverActive}
      activator={
        <Button icon={FilterIcon} onClick={() => setFilterPopoverActive((v) => !v)}>
          {t("common.filter")}
        </Button>
      }
      onClose={() => setFilterPopoverActive(false)}
      autofocusTarget="none"
    >
      <Box padding="400" minWidth="280px">
        <BlockStack gap="400">
          <ChoiceList
            title={t("disputes.phaseLabel")}
            choices={[
              { label: t("disputes.inquiryBadge"), value: "inquiry" },
              { label: t("disputes.chargebackBadge"), value: "chargeback" },
            ]}
            selected={phaseFilter}
            onChange={(v) => {
              setPhaseFilter(v);
              setPage(1);
            }}
            allowMultiple
          />
          <ChoiceList
            title={t("disputes.filterNormalizedStatus")}
            choices={[
              { label: t("disputeTimeline.normalizedStatuses.new"), value: "new" },
              { label: t("disputeTimeline.normalizedStatuses.in_progress"), value: "in_progress" },
              { label: t("disputeTimeline.normalizedStatuses.needs_review"), value: "needs_review" },
              { label: t("disputeTimeline.normalizedStatuses.ready_to_submit"), value: "ready_to_submit" },
              { label: t("disputeTimeline.normalizedStatuses.action_needed"), value: "action_needed" },
              { label: t("disputeTimeline.normalizedStatuses.submitted_to_shopify"), value: "submitted_to_shopify" },
              { label: t("disputeTimeline.normalizedStatuses.submitted_to_bank"), value: "submitted_to_bank" },
              { label: t("disputeTimeline.normalizedStatuses.won"), value: "won" },
              { label: t("disputeTimeline.normalizedStatuses.lost"), value: "lost" },
            ]}
            selected={normalizedStatusFilter}
            onChange={(v) => {
              setNormalizedStatusFilter(v);
              setPage(1);
            }}
            allowMultiple
          />
          {activeTab === "closed" && (
            <ChoiceList
              title={t("disputes.filterOutcome")}
              choices={[
                { label: t("disputeTimeline.outcomes.won"), value: "won" },
                { label: t("disputeTimeline.outcomes.lost"), value: "lost" },
                { label: t("disputeTimeline.outcomes.refunded"), value: "refunded" },
                { label: t("disputeTimeline.outcomes.accepted"), value: "accepted" },
                { label: t("disputeTimeline.outcomes.canceled"), value: "canceled" },
                { label: t("disputeTimeline.outcomes.expired"), value: "expired" },
              ]}
              selected={outcomeFilter}
              onChange={(v) => {
                setOutcomeFilter(v);
                setPage(1);
              }}
              allowMultiple
            />
          )}
        </BlockStack>
      </Box>
    </Popover>
  );

  const sortPopover = (
    <Popover
      active={sortPopoverActive}
      activator={
        <Button icon={SortIcon} onClick={() => setSortPopoverActive((v) => !v)}>
          {t("disputes.mobileSort")}
        </Button>
      }
      onClose={() => setSortPopoverActive(false)}
      autofocusTarget="none"
    >
      <Box padding="400" minWidth="260px">
        <ChoiceList
          title={t("disputes.mobileSort")}
          choices={sortChoices}
          selected={[effectiveSortValue]}
          onChange={(v) => {
            const next = v[0] as SortMode;
            setSortMode(next);
            setPage(1);
            setSortPopoverActive(false);
          }}
        />
      </Box>
    </Popover>
  );

  return (
    <Page
      title={t("disputes.title")}
      subtitle={t("disputes.purposeLine")}
      primaryAction={{
        content: syncing ? t("disputes.syncing") : t("disputes.syncNow"),
        onAction: () => void handleSync(),
        loading: syncing,
        disabled: syncing,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* KPI row — Figma section 2. Renders only when at least
                one dispute is loaded. */}
            {!loading && disputes.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: smDown
                    ? "1fr 1fr"
                    : "repeat(4, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                <KpiCard
                  label={t("disputes.kpiNeedsAction")}
                  value={String(kpis.needsActionCount)}
                  subtitle={
                    kpis.urgentCount > 0
                      ? t("disputes.kpiNeedsActionUrgent", {
                          count: kpis.urgentCount,
                        })
                      : undefined
                  }
                  subtitleColor="#F59E0B"
                />
                <KpiCard
                  label={t("disputes.kpiAmountAtRisk")}
                  value={formatCurrency(
                    kpis.totalAtRisk,
                    disputes[0]?.currency_code ?? "USD",
                    numberLocale,
                  )}
                />
                <KpiCard
                  label={t("disputes.kpiStrongCases")}
                  value={String(kpis.strongCasesCount)}
                  subtitle={t("disputes.kpiStrongCasesSub")}
                  subtitleColor="#065F46"
                />
                <KpiCard
                  label={t("disputes.kpiAwaitingResponse")}
                  value={String(kpis.awaitingResponseCount)}
                  subtitle={t("disputes.kpiAwaitingResponseSub")}
                />
              </div>
            )}

            {/* Red urgent banner — only when ≥1 urgent dispute. Resolve
                now deep-links to the first urgent dispute's detail page;
                View all pre-filters the list. */}
            {!loading && kpis.urgentCount > 0 && (
              <div
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FCA5A5",
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        color: "#DC2626",
                        flexShrink: 0,
                        marginTop: 2,
                        display: "inline-flex",
                      }}
                    >
                      <Icon source={AlertCircleIcon} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#991B1B",
                          lineHeight: 1.4,
                        }}
                      >
                        {t("disputes.urgentBannerTitle", {
                          count: kpis.urgentCount,
                        })}
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          color: "#991B1B",
                          lineHeight: 1.4,
                        }}
                      >
                        {t("disputes.urgentBannerBody", {
                          amount: formatCurrency(
                            kpis.urgentAmount,
                            disputes[0]?.currency_code ?? "USD",
                            numberLocale,
                          ),
                          days: kpis.earliestDueInDays ?? 0,
                        })}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (firstUrgent) {
                          const href = withShopParams(
                            `/app/disputes/${firstUrgent.id}`,
                            searchParams ?? new URLSearchParams(),
                          );
                          window.location.assign(href);
                        }
                      }}
                      style={{
                        padding: "8px 16px",
                        background: "#DC2626",
                        border: "1px solid #DC2626",
                        borderRadius: 6,
                        color: "#ffffff",
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {t("disputes.urgentBannerResolve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        applyStatusDropdown("action_needed");
                        setSortMode("urgency");
                      }}
                      style={{
                        padding: "8px 16px",
                        background: "transparent",
                        border: "1px solid #DC2626",
                        borderRadius: 6,
                        color: "#DC2626",
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {t("disputes.urgentBannerViewAll")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {!loading && !hasAlertEmail && (
              <Banner tone="info">
                <p>
                  {t("disputes.alertsNudge")}{" "}
                  <a
                    href={withShopParams("/app/settings", searchParams)}
                    style={{ fontWeight: 600 }}
                  >
                    {t("disputes.alertsNudgeLink")}
                  </a>
                </p>
              </Banner>
            )}

            {/* Filters bar — status dropdown + search + Filter + Export.
                Mobile stacks the dropdown above the search. */}
            <Card>
              {smDown ? (
                <BlockStack gap="300">
                  <Select
                    label={t("disputes.statusDropdown.all")}
                    labelHidden
                    options={[
                      { label: t("disputes.statusDropdown.all"), value: "all" },
                      { label: t("disputes.statusDropdown.actionNeeded"), value: "action_needed" },
                      { label: t("disputes.statusDropdown.needsReview"), value: "needs_review" },
                      { label: t("disputes.statusDropdown.underReview"), value: "under_review" },
                      { label: t("disputes.statusDropdown.submitted"), value: "submitted" },
                      { label: t("disputes.statusDropdown.closed"), value: "closed" },
                    ]}
                    value={statusDropdown}
                    onChange={applyStatusDropdown}
                  />
                  <TextField
                    label={t("disputes.searchPlaceholder")}
                    labelHidden
                    placeholder={t("disputes.searchPlaceholder")}
                    value={queryValue}
                    onChange={setQueryValue}
                    prefix={<Icon source={SearchIcon} />}
                    autoComplete="off"
                  />
                  <InlineStack gap="200" wrap={false}>
                    <div className={styles.mobileActionsButton}>{filterPopover}</div>
                    <div className={styles.mobileActionsButton}>{sortPopover}</div>
                  </InlineStack>
                </BlockStack>
              ) : (
                <InlineStack gap="300" align="start" blockAlign="center" wrap={false}>
                  <div style={{ minWidth: 180 }}>
                    <Select
                      label={t("disputes.statusDropdown.all")}
                      labelHidden
                      options={[
                        { label: t("disputes.statusDropdown.all"), value: "all" },
                        { label: t("disputes.statusDropdown.actionNeeded"), value: "action_needed" },
                        { label: t("disputes.statusDropdown.needsReview"), value: "needs_review" },
                        { label: t("disputes.statusDropdown.underReview"), value: "under_review" },
                        { label: t("disputes.statusDropdown.submitted"), value: "submitted" },
                        { label: t("disputes.statusDropdown.closed"), value: "closed" },
                      ]}
                      value={statusDropdown}
                      onChange={applyStatusDropdown}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      label={t("disputes.searchPlaceholder")}
                      labelHidden
                      placeholder={t("disputes.searchPlaceholder")}
                      value={queryValue}
                      onChange={setQueryValue}
                      prefix={<Icon source={SearchIcon} />}
                      autoComplete="off"
                    />
                  </div>
                  {filterPopover}
                  <Button icon={ExportIcon} onClick={exportCsv}>
                    {t("disputes.export")}
                  </Button>
                </InlineStack>
              )}
            </Card>

            {/* List */}
            {loading ? (
              <Card padding="0">
                <div className={styles.loadingWrap}>
                  <Spinner size="large" />
                </div>
              </Card>
            ) : visibleDisputes.length === 0 ? (
              <Card>
                <Box padding="500">
                  <Text as="p" tone="subdued">
                    {disputes.length === 0
                      ? t("disputes.noDisputes")
                      : t("disputes.noMatchingDisputes")}
                  </Text>
                </Box>
              </Card>
            ) : smDown ? (
              <MobileDisputesList
                disputes={visibleDisputes}
                activeTab={activeTab}
                searchParams={searchParams}
                dateLocale={dateLocale}
                numberLocale={numberLocale}
                t={t}
              />
            ) : (
              <DesktopDisputesTable
                disputes={visibleDisputes}
                activeTab={activeTab}
                searchParams={searchParams}
                dateLocale={dateLocale}
                numberLocale={numberLocale}
                t={t}
              />
            )}

            {pagination.total_pages > 1 && (
              <InlineStack align="center">
                <Pagination
                  hasPrevious={page > 1}
                  hasNext={page < pagination.total_pages}
                  onPrevious={() => setPage(page - 1)}
                  onNext={() => setPage(page + 1)}
                  label={t("common.page", { page, total: pagination.total_pages })}
                />
              </InlineStack>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

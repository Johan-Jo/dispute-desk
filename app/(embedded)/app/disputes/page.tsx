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
  Badge,
  BlockStack,
  Banner,
  Text,
  useBreakpoints,
} from "@shopify/polaris";
import { SearchIcon, FilterIcon, ExportIcon, SortIcon } from "@shopify/polaris-icons";
import styles from "./disputes-list.module.css";
import { DesktopDisputesTable } from "./DesktopDisputesTable";
import { MobileDisputesList } from "./MobileDisputesList";
import {
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

  // Summary counts
  const summaryInquiries = disputes.filter((d) => d.phase === "inquiry").length;
  const summaryChargebacks = disputes.filter((d) => d.phase === "chargeback").length;
  const summaryNeedsReview = disputes.filter((d) => d.needs_review).length;
  const summaryNeedsSync = disputes.filter((d) => !d.phase).length;
  const summaryUrgent = disputes.filter((d) => {
    if (!d.due_at) return false;
    const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursLeft <= 48;
  }).length;

  const stateSentence = (() => {
    if (disputes.length === 0) return t("disputes.stateZero");
    if (summaryNeedsSync > 0)
      return t("disputes.stateNeedsSync", { total: disputes.length, sync: summaryNeedsSync });
    if (summaryUrgent > 0)
      return t("disputes.stateSomeUrgent", { total: disputes.length, urgent: summaryUrgent });
    if (summaryNeedsReview > 0)
      return t("disputes.stateNeedsReview", { total: disputes.length, review: summaryNeedsReview });
    return t("disputes.stateAllClear", { total: disputes.length });
  })();

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
            {!loading && (
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyLg" fontWeight="semibold">
                    {stateSentence}
                  </Text>
                  {disputes.length > 0 && (
                    <InlineStack gap="200" wrap>
                      {summaryInquiries > 0 && (
                        <Badge tone="info">{t("disputes.summaryInquiries", { count: summaryInquiries })}</Badge>
                      )}
                      {summaryChargebacks > 0 && (
                        <Badge tone="warning">{t("disputes.summaryChargebacks", { count: summaryChargebacks })}</Badge>
                      )}
                      {summaryNeedsReview > 0 && (
                        <Badge tone="attention">{t("disputes.summaryNeedsReview", { count: summaryNeedsReview })}</Badge>
                      )}
                      {summaryNeedsSync > 0 && (
                        <Badge tone="critical">{t("disputes.summaryNeedsSync", { count: summaryNeedsSync })}</Badge>
                      )}
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>
            )}

            {!loading && summaryNeedsReview > 0 && (
              <Banner tone="warning">
                <p>{t("disputes.needsReviewBanner", { count: summaryNeedsReview })}</p>
              </Banner>
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

            <InlineStack gap="200">
              {(["active", "closed", "all"] as const).map((tab) => (
                <Button
                  key={tab}
                  pressed={activeTab === tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setPage(1);
                  }}
                  size="slim"
                >
                  {t(`disputes.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
                </Button>
              ))}
            </InlineStack>

            {/* Actions bar — desktop: search + filter + export; mobile: stacked, filter + sort */}
            <Card>
              {smDown ? (
                <BlockStack gap="300">
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
              <Card padding="0">
                <DesktopDisputesTable
                  disputes={visibleDisputes}
                  activeTab={activeTab}
                  searchParams={searchParams}
                  dateLocale={dateLocale}
                  numberLocale={numberLocale}
                  t={t}
                />
              </Card>
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

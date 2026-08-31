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
  figmaIsUrgent,
  figmaKpis,
  formatCurrency,
  formatDueDate,
  formatShortId,
  csvEscape,
  orderLabel,
  parseListDeepLink,
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
  aggregates?: {
    needs_attention: number;
    /** Genuine merchant tasks only (blocking + requested) — plan §5. */
    merchant_action_required?: number;
    /** Shop-wide KPI facts (plan §5.1) — never page-scoped. */
    active_count?: number;
    under_review_count?: number;
    amount_at_risk?: number;
    amount_at_risk_currency?: string;
    /** Dispute COUNTS per non-primary currency (§13). */
    other_currency_counts?: Record<string, number>;
  };
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

  // Publish the most recent dispute id to a window-scoped global so the
  // "Handle a Dispute" interactive tour can navigate to a real dispute
  // when the merchant clicks Next on the dispute-row step. Read by
  // EmbeddedTourOverlay via OnboardingNextAction = "navigateToFirstDispute".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __ddFirstDisputeId?: string };
    w.__ddFirstDisputeId = disputes[0]?.id;
  }, [disputes]);

  // Deep-links from the dashboard land on this page with a
  // `?normalized_status=…` (and optionally `?closed=…`) param — e.g. the
  // "Needs action" tile opens `?normalized_status=new,action_needed,needs_review`.
  // Read those once on mount so the initial list fetch is actually filtered.
  // Previously the URL param was ignored: state started at `[]` / tab "all",
  // so the list fetched UNFILTERED and showed resolved/closed disputes under
  // a "needs action" heading (blume-box, 2026-07-22). `closed` disputes carry
  // a stale `due_at`, so with the due-date sort they even floated to the top.
  // Mount-only: subsequent navigation is driven by in-page state, not the URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialUrlFilters = useMemo(() => parseListDeepLink(searchParams), []);

  const [loading, setLoading] = useState(true);
  /* Export walks every page, so it is not instant on a large shop. The button
   * reflects that rather than appearing dead. */
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [normalizedStatusFilter, setNormalizedStatusFilter] = useState<string[]>(
    initialUrlFilters.statuses,
  );
  const [outcomeFilter, setOutcomeFilter] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>(initialUrlFilters.tab);
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });
  // Shop-wide "needs attention" count from the API (matches the dashboard),
  // independent of the current page/filter — see /api/disputes aggregates.
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);
  const [sortPopoverActive, setSortPopoverActive] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [hasAlertEmail, setHasAlertEmail] = useState(true);
  /** Quick-preset status dropdown — "All status / Action needed /
   *  Needs review / Under review / Submitted / Closed". Maps onto
   *  `normalizedStatusFilter` and `activeTab`. The detailed Filter
   *  popover stays for power users. */
  const [statusDropdown, setStatusDropdown] = useState<string>("all");

  /** Attention filter param (plan §11) — independent of lifecycle and
   *  strength. `tasks` = genuine merchant tasks; `comm` =
   *  communication-review states. */
  const [attentionParam, setAttentionParam] = useState<"" | "tasks" | "comm">(
    initialUrlFilters.attention,
  );
  /** Evidence-strength filter (plan §11.2) — the independent strength
   *  dimension; never mixed with lifecycle or attention. */
  const [strengthFilter, setStrengthFilter] = useState<"" | "strong" | "moderate" | "weak">("");
  const [shopKpis, setShopKpis] = useState<{
    active: number;
    underReview: number;
    atRisk: number;
    atRiskCurrency: string;
    otherCurrencyCounts: Record<string, number>;
  } | null>(null);
  const [submissionStateFilter, setSubmissionStateFilter] = useState<string[]>([]);
  const [outcomeDropdownFilter, setOutcomeDropdownFilter] = useState<string[]>([]);

  /** Status dropdown → the three independent query dimensions
   *  (plan §11): lifecycle values query lifecycle facts; the
   *  communication / attention options query the attention dimension;
   *  Won/Lost query final outcomes. NOT a renamed version of the old
   *  merged filter — each option's query logic matches its dimension. */
  const applyStatusDropdown = useCallback((value: string) => {
    setStatusDropdown(value);
    setPage(1);
    // Reset all dimension filters, then apply the selected one.
    setNormalizedStatusFilter([]);
    setSubmissionStateFilter([]);
    setOutcomeDropdownFilter([]);
    setAttentionParam("");
    switch (value) {
      case "all":
        setActiveTab("all");
        return;
      case "monitoring":
        // Lifecycle: building + monitoring + prepared (unsaved actives).
        setActiveTab("active");
        setNormalizedStatusFilter([
          "new",
          "in_progress",
          "needs_review",
          "ready_to_submit",
          "action_needed",
        ]);
        return;
      case "comm":
        // Attention dimension: communication awaiting review.
        setActiveTab("active");
        setAttentionParam("comm");
        return;
      case "saved":
        // Lifecycle: evidence saved to Shopify (authoritative state).
        setActiveTab("active");
        setSubmissionStateFilter(["saved_to_shopify"]);
        return;
      case "review":
        // Lifecycle: under review (confirmed transmission family).
        setActiveTab("active");
        setNormalizedStatusFilter([
          "submitted",
          "submitted_to_bank",
          "waiting_on_issuer",
        ]);
        return;
      case "won":
        setActiveTab("all");
        setOutcomeDropdownFilter(["won"]);
        return;
      case "lost":
        setActiveTab("all");
        setOutcomeDropdownFilter(["lost"]);
        return;
      case "closed":
        setActiveTab("closed");
        return;
      case "attention":
        // Attention dimension: genuine merchant tasks only.
        setActiveTab("active");
        setAttentionParam("tasks");
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

  /* The filter half of the query string, WITHOUT page/per_page.
   *
   * Extracted so the CSV export sends the identical filter set the table is
   * showing. When the export built its own params (or, worse, reused only the
   * rows already in memory) the two could disagree, and a merchant who
   * filtered to "Under review" could export something else entirely. One
   * builder, two callers. */
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
    if (phaseFilter.length === 1) params.set("phase", phaseFilter[0]);
    if (normalizedStatusFilter.length > 0)
      params.set("normalized_status", normalizedStatusFilter.join(","));
    const outcomes = outcomeFilter.length > 0 ? outcomeFilter : outcomeDropdownFilter;
    if (outcomes.length > 0) params.set("final_outcome", outcomes.join(","));
    if (submissionStateFilter.length > 0)
      params.set("submission_state", submissionStateFilter.join(","));
    if (attentionParam) params.set("attention", attentionParam);
    if (strengthFilter) params.set("strength", strengthFilter);
    if (activeTab === "active") {
      params.set("closed", "false");
    } else if (activeTab === "closed") {
      params.set("closed", "true");
    }
    const { sort, sort_dir } = resolveSort(sortMode, activeTab);
    params.set("sort", sort);
    params.set("sort_dir", sort_dir);
    return params;
  }, [statusFilter, phaseFilter, normalizedStatusFilter, outcomeFilter, outcomeDropdownFilter, submissionStateFilter, attentionParam, strengthFilter, activeTab, sortMode]);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.set("page", String(page));
      params.set("per_page", "25");
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
      // Genuine merchant tasks only — no fallback to the legacy
      // needs_attention aggregate (it counts internal failures the
      // model excludes; plan §5.1).
      setNeedsAttentionCount(json.aggregates?.merchant_action_required ?? 0);
      if (json.aggregates?.active_count !== undefined) {
        setShopKpis({
          active: json.aggregates.active_count ?? 0,
          underReview: json.aggregates.under_review_count ?? 0,
          atRisk: json.aggregates.amount_at_risk ?? 0,
          atRiskCurrency: json.aggregates.amount_at_risk_currency ?? "USD",
          otherCurrencyCounts: json.aggregates.other_currency_counts ?? {},
        });
      }
    } finally {
      setLoading(false);
    }
  }, [page, buildFilterParams]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  // Preserve the merchant's chosen sort across tab switches instead of
  // wiping it every time. Only clear it when the current mode is invalid
  // for the new tab: `closed_desc` (recently-closed) is offered on the
  // closed tab only, so drop it back to `default` when leaving that tab.
  // `default` itself resolves to due-date order on open tabs and
  // closed-date order on the closed tab (see resolveSort), so a merchant
  // who never touches the sort control always gets the sensible per-tab
  // ordering.
  useEffect(() => {
    if (activeTab !== "closed" && sortMode === "closed_desc") {
      setSortMode("default");
    }
  }, [activeTab, sortMode]);

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

  /* The search box filters in the browser and is never sent to the API, so the
   * CSV export has to apply the SAME predicate to the rows it fetches —
   * otherwise a merchant who searched "Fred" would export every dispute in the
   * shop. Shared here so the two cannot drift. */
  const matchesQuery = useCallback(
    (d: Dispute, rawQuery: string) => {
      const q = rawQuery.toLowerCase();
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
    },
    [],
  );

  const visibleDisputes = queryValue
    ? disputes.filter((d) => matchesQuery(d, queryValue))
    : disputes;

  /* Export EVERY dispute matching the current filters, not the 25 rows the
   * table happens to be showing.
   *
   * Two defects, reported by a merchant 2026-08-31:
   *
   *   1. It exported `visibleDisputes` — the current PAGE. A merchant with
   *      1,125 disputes clicked Export and got 25 rows with no indication the
   *      other 1,100 were missing. A truncated export is worse than a failed
   *      one: it looks complete, so it gets used for reconciliation.
   *   2. It had no dispute-opened date. `initiated_at` is the date the
   *      cardholder actually filed the chargeback, is what the table sorts and
   *      renders, and is the first thing anyone reconciling against a
   *      processor statement needs. Every other date was present.
   *
   * The API caps per_page at 100, so this walks the pages. The filter params
   * come from the SAME builder the table uses, so the file always matches what
   * the merchant is looking at. */
  const exportCsv = async () => {
    /* RFC-4180 escaping lives in disputeListHelpers so it can be unit-tested;
     * the old inline version quoted on comma alone and never escaped an
     * embedded quote. */
    const esc = csvEscape;

    setExporting(true);
    try {
      const all: Dispute[] = [];
      const PER_PAGE = 100;
      /* Hard stop so a pagination bug can never spin forever in the merchant's
       * browser. 200 pages x 100 = 20,000 disputes, far above any real shop. */
      for (let p = 1; p <= 200; p++) {
        const params = buildFilterParams();
        params.set("page", String(p));
        params.set("per_page", String(PER_PAGE));
        const res = await fetch(`/api/disputes?${params}`);
        if (!res.ok) break;
        const json: DisputesResponse = await res.json();
        const batch = json.disputes ?? [];
        all.push(...batch);
        if (batch.length < PER_PAGE) break;
        if (json.pagination && p >= json.pagination.total_pages) break;
      }

      const exportRows = queryValue
        ? all.filter((d) => matchesQuery(d, queryValue))
        : all;

      const rows = exportRows.map((d) =>
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
          esc(formatDueDate(d.initiated_at, dateLocale)),
          esc(formatDueDate(d.due_at, dateLocale)),
          esc(formatDueDate(d.submitted_at ?? null, dateLocale)),
          esc(formatDueDate(d.closed_at ?? null, dateLocale)),
          d.final_outcome ?? "",
          d.outcome_amount_recovered != null ? String(d.outcome_amount_recovered) : "",
          d.outcome_amount_lost != null ? String(d.outcome_amount_lost) : "",
          esc(formatDueDate(d.last_event_at ?? null, dateLocale)),
        ].join(","),
      );
      const csvHeader = [
        t("disputes.csvOrder"), t("disputes.csvId"), t("disputes.csvCustomer"),
        t("disputes.csvAmount"), t("disputes.csvReason"), t("disputes.csvFamily"),
        t("disputes.csvPhase"), t("disputes.csvStatus"),
        t("disputes.csvNormalizedStatus"), t("disputes.csvSubmissionState"),
        t("disputes.csvDisputeDate"),
        t("disputes.csvDueDate"), t("disputes.csvSubmittedAt"), t("disputes.csvClosedAt"),
        t("disputes.csvOutcome"), t("disputes.csvRecovered"), t("disputes.csvLost"),
        t("disputes.csvLastEvent"),
      ].map((h) => esc(h)).join(",");
      /* BOM so Excel reads it as UTF-8 — without it, accented customer names
       * render as mojibake on the merchant's machine. */
      const csv = "\uFEFF" + [csvHeader, ...rows].join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      a.download = "disputes.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  // KPIs for the Figma 4-card row + red urgent banner.
  const kpis = useMemo(
    () => figmaKpis(disputes, shopKpis?.atRiskCurrency ?? null),
    [disputes, shopKpis?.atRiskCurrency],
  );

  // Shared-model KPI values (plan §5): Active = unresolved pre-outcome
  // (INCLUDES under-review; allow-list based, not final_outcome-null);
  // Amount at risk = sum over that same active set; Under review =
  // transmission confirmed, no outcome yet. Page-scoped like the
  // legacy figmaKpis; the Merchant-action card uses the shop-wide
  // aggregate instead.
  const presKpis = useMemo(() => {
    let active = 0;
    let underReview = 0;
    let atRisk = 0;
    for (const d of disputes) {
      const p = d.presentation;
      const isActive = p ? p.isActive : !d.closed_at;
      if (isActive) {
        active += 1;
        atRisk += Number(d.amount) || 0;
      }
      if (p && p.transmissionConfirmed && !p.terminal) underReview += 1;
    }
    return { active, underReview, atRisk };
  }, [disputes]);

  /** Find the first urgent dispute's id so the "Resolve now" button on
   *  the red banner can deep-link the merchant straight to the most
   *  pressing case. Falls back to navigating to the filtered list. */
  const firstUrgent = useMemo(() => {
    // SAME predicate as the banner count (figmaIsUrgent): a genuine
    // merchant task with a tight deadline — the banner must never
    // deep-link to a dispute it does not itself count as urgent.
    const urgent = disputes
      .filter((d) => figmaIsUrgent(d))
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

  // Status dropdown — mockup vocabulary over three independent
  // dimensions (plan §11). "Sent to card network" is deliberately NOT a
  // value: with current data it is indistinguishable from Under review.
  const statusDropdownOptions = [
    { label: t("disputes.statusDropdown.all"), value: "all" },
    { label: t("disputes.statusDropdown.monitoring"), value: "monitoring" },
    { label: t("disputes.statusDropdown.comm"), value: "comm" },
    { label: t("disputes.statusDropdown.saved"), value: "saved" },
    { label: t("disputes.statusDropdown.underReview"), value: "review" },
    { label: t("disputes.statusDropdown.won"), value: "won" },
    { label: t("disputes.statusDropdown.lost"), value: "lost" },
    { label: t("disputes.statusDropdown.closed"), value: "closed" },
    { label: t("disputes.statusDropdown.attention"), value: "attention" },
  ];

  // Independent evidence-strength filter (plan §11.2) — rules-engine
  // grade only, never lifecycle.
  const strengthFilterOptions = [
    { label: t("disputes.strengthFilterAny"), value: "" },
    { label: t("presentation.strength.list.strong"), value: "strong" },
    { label: t("presentation.strength.list.moderate"), value: "moderate" },
    { label: t("presentation.strength.list.weak"), value: "weak" },
  ];
  const applyStrengthFilter = (value: string) => {
    setPage(1);
    setStrengthFilter(value as "" | "strong" | "moderate" | "weak");
  };

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
                data-help-guide="disputes-kpi-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: smDown
                    ? "1fr 1fr"
                    : "repeat(4, minmax(0, 1fr))",
                  gap: 16,
                }}
              >
                {/* Plan §5: Active disputes (pre-outcome, INCLUDING
                    under-review) / Amount at risk / Merchant action
                    required (genuine tasks, shop-wide) / Under review.
                    One source per card — no dual-source drift. */}
                <KpiCard
                  label={t("disputes.kpiActiveDisputes")}
                  value={String(shopKpis?.active ?? presKpis.active)}
                  subtitle={t("disputes.kpiActiveDisputesSub")}
                />
                <KpiCard
                  label={t("disputes.kpiAmountAtRisk")}
                  value={formatCurrency(
                    shopKpis?.atRisk ?? presKpis.atRisk,
                    shopKpis?.atRiskCurrency ?? disputes[0]?.currency_code ?? "USD",
                    numberLocale,
                  )}
                  subtitle={
                    shopKpis && Object.keys(shopKpis.otherCurrencyCounts).length > 0
                      ? // §13 currency rule: other currencies are DISPUTE
                        // COUNTS ("Plus N disputes in CAD"), never amounts.
                        t("disputes.kpiAmountAtRiskOther", {
                          list: Object.entries(shopKpis.otherCurrencyCounts)
                            .map(([code, n]) => `${n} ${code}`)
                            .join(" · "),
                        })
                      : t("disputes.kpiAmountAtRiskSub")
                  }
                />
                <KpiCard
                  label={t("disputes.kpiNeedsAction")}
                  value={String(needsAttentionCount)}
                  subtitle={
                    kpis.urgentCount > 0
                      ? t("disputes.kpiNeedsActionUrgent", {
                          count: kpis.urgentCount,
                        })
                      : undefined
                  }
                  subtitleColor={needsAttentionCount > 0 ? "#B45309" : "#6D7175"}
                />
                <KpiCard
                  label={t("disputes.kpiUnderReview")}
                  value={String(shopKpis?.underReview ?? presKpis.underReview)}
                  subtitle={t("disputes.kpiUnderReviewSub")}
                />
              </div>
            )}

            {/* Red urgent banner — only when ≥1 urgent dispute. Resolve
                now deep-links to the first urgent dispute's detail page;
                View all pre-filters the list. */}
            {!loading && kpis.urgentCount > 0 && (
              <div
                data-help-guide="disputes-urgent-banner"
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
                        {kpis.earliestOverdue
                          ? t("disputes.urgentBannerBodyOverdue", {
                              amount: formatCurrency(
                                kpis.urgentAmount,
                                kpis.urgentAmountCurrency ?? "USD",
                                numberLocale,
                              ),
                            })
                          : t("disputes.urgentBannerBody", {
                              amount: formatCurrency(
                                kpis.urgentAmount,
                                kpis.urgentAmountCurrency ?? "USD",
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
                        applyStatusDropdown("attention");
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
                    options={statusDropdownOptions}
                    value={statusDropdown}
                    onChange={applyStatusDropdown}
                  />
                  <Select
                    label={t("disputes.strengthFilterAny")}
                    labelHidden
                    options={strengthFilterOptions}
                    value={strengthFilter}
                    onChange={applyStrengthFilter}
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
                      options={statusDropdownOptions}
                      value={statusDropdown}
                      onChange={applyStatusDropdown}
                    />
                  </div>
                  <div style={{ minWidth: 170 }}>
                    <Select
                      label={t("disputes.strengthFilterAny")}
                      labelHidden
                      options={strengthFilterOptions}
                      value={strengthFilter}
                      onChange={applyStrengthFilter}
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
                  {sortPopover}
                  <Button icon={ExportIcon} onClick={exportCsv} loading={exporting} disabled={exporting}>
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
              <div data-help-guide="disputes-table">
                <MobileDisputesList
                  disputes={visibleDisputes}
                  activeTab={activeTab}
                  searchParams={searchParams}
                  dateLocale={dateLocale}
                  numberLocale={numberLocale}
                  t={t}
                />
              </div>
            ) : (
              <div data-help-guide="disputes-table">
                <DesktopDisputesTable
                  disputes={visibleDisputes}
                  activeTab={activeTab}
                  searchParams={searchParams}
                  dateLocale={dateLocale}
                  numberLocale={numberLocale}
                  t={t}
                />
              </div>
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

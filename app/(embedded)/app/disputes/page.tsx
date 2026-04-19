/**
 * Embedded disputes list — Polaris Page/Layout/Card shell with Figma-matched
 * inner table (shopify-disputes.tsx reference).
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { recentDisputesViewDetailsLinkStyle } from "@/lib/embedded/recentDisputesTableStyles";
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
} from "@shopify/polaris";
import {
  SearchIcon,
  FilterIcon,
  ExportIcon,
} from "@shopify/polaris-icons";
import styles from "./disputes-list.module.css";
import { DISPUTE_REASON_FAMILIES, type AllDisputeReasonCode } from "@/lib/rules/disputeReasons";
import { phaseBadgeTone, phaseLabel as phaseLabelFn } from "@/lib/disputes/phaseUtils";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  order_name?: string | null;
  customer_display_name?: string | null;
  status: string | null;
  reason: string | null;
  phase: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
  initiated_at: string | null;
  needs_review: boolean;
  last_synced_at: string | null;
  normalized_status?: string | null;
  submission_state?: string | null;
  final_outcome?: string | null;
  closed_at?: string | null;
  submitted_at?: string | null;
  outcome_amount_recovered?: number | null;
  outcome_amount_lost?: number | null;
  last_event_at?: string | null;
}

type TabId = "active" | "closed" | "all";

interface DisputesResponse {
  disputes: Dispute[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

const NORMALIZED_STATUS_TONE: Record<string, "success" | "critical" | "warning" | "info" | "attention" | undefined> = {
  won: "success", lost: "critical", new: "info", in_progress: "info",
  needs_review: "attention", ready_to_submit: "attention", action_needed: "warning",
  submitted: "info", submitted_to_shopify: "info",
  waiting_on_issuer: "info", submitted_to_bank: "info",
  accepted_not_contested: "success", closed_other: "success",
};

const OUTCOME_TONE: Record<string, "success" | "critical" | "warning" | undefined> = {
  won: "success", lost: "critical", refunded: "warning", accepted: "warning",
  partially_won: "success", canceled: undefined, expired: undefined,
};

function relativeTime(iso: string | null, t: (key: string) => string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t("common.minutesAgo").replace("{n}", String(Math.max(1, mins)));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("common.hoursAgo").replace("{n}", String(hours));
  const days = Math.floor(hours / 24);
  return t("common.daysAgo").replace("{n}", String(days));
}

function translateReason(reason: string | null, t: (key: string) => string): string {
  if (!reason) return "—";
  const key = `disputeReasons.${reason}`;
  const translated = t(key);
  // Fallback to title-cased reason if key is missing
  if (translated === key) {
    return reason
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return translated;
}

function translateFamily(reason: string | null, t: (key: string) => string): string {
  const family = DISPUTE_REASON_FAMILIES[reason as AllDisputeReasonCode];
  if (!family) return "";
  const key = `disputeFamilies.${family}`;
  const translated = t(key);
  return translated === key ? family : translated;
}

function formatCurrency(
  amount: number | null,
  code: string | null,
  locale: string,
): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

/** Same as dashboard Recent Disputes — first 8 chars of id, uppercased */
function formatShortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function formatListDisputeId(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `DP-${hex}`;
}

function orderLabel(d: Dispute): string {
  return (
    d.order_name ?? (d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—")
  );
}

export default function DisputesListPage() {
  const searchParams = useSearchParams();
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

  const numberLocale = dateLocale;

  const formatDueDate = useCallback(
    (iso: string | null) => {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString(dateLocale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
    [dateLocale],
  );

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
  const [pagination, setPagination] = useState({
    total: 0,
    total_pages: 0,
  });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);
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
      if (statusFilter.length > 0)
        params.set("status", statusFilter.join(","));
      if (phaseFilter.length === 1)
        params.set("phase", phaseFilter[0]);
      if (normalizedStatusFilter.length > 0)
        params.set("normalized_status", normalizedStatusFilter.join(","));
      if (outcomeFilter.length > 0)
        params.set("final_outcome", outcomeFilter.join(","));
      if (activeTab === "active") {
        params.set("closed", "false");
        params.set("sort", "created_at");
        params.set("sort_dir", "desc");
      } else if (activeTab === "closed") {
        params.set("closed", "true");
        params.set("sort", "closed_at");
        params.set("sort_dir", "desc");
      } else {
        params.set("sort", "created_at");
        params.set("sort_dir", "desc");
      }
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, phaseFilter, normalizedStatusFilter, outcomeFilter, activeTab]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

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

  const statusLabelForCsv = (status: string | null): string => {
    if (!status) return t("disputes.statusUnknown");
    switch (status) {
      case "needs_response":
        return t("disputes.statusOpen");
      case "under_review":
        return t("disputes.statusUnderReview");
      case "charge_refunded":
      case "won":
        return t("disputes.statusWon");
      case "lost":
        return t("disputes.statusLost");
      default:
        return status.replace(/_/g, " ");
    }
  };

  const badgeTone = (status: string | null): "success" | "critical" | "warning" | "info" | undefined => {
    switch (status) {
      case "charge_refunded":
      case "won":
        return "success";
      case "lost":
        return "critical";
      case "under_review":
        return "warning";
      case "needs_response":
        return "info";
      default:
        return undefined;
    }
  };

  const badgeLabel = (status: string | null): string => {
    if (!status) return t("disputes.statusUnknown");
    switch (status) {
      case "needs_response":
        return t("disputes.statusOpen");
      case "under_review":
        return t("disputes.statusUnderReview");
      case "charge_refunded":
      case "won":
        return t("disputes.statusWon");
      case "lost":
        return t("disputes.statusLost");
      default:
        return status.replace(/_/g, " ");
    }
  };

  const visibleDisputes = queryValue
    ? disputes.filter((d) => {
        const q = queryValue.toLowerCase();
        const dp = formatListDisputeId(d.id).toLowerCase();
        const short = formatShortId(d.id).toLowerCase();
        return (
          d.dispute_gid.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          short.includes(q) ||
          dp.includes(q) ||
          (d.reason ?? "").toLowerCase().includes(q) ||
          (d.order_gid ?? "").toLowerCase().includes(q) ||
          (d.order_name ?? "").toLowerCase().includes(q) ||
          (d.customer_display_name ?? "").toLowerCase().includes(q)
        );
      })
    : disputes;

  const exportCsv = () => {
    const esc = (v: string) => v.includes(",") ? `"${v}"` : v;
    const rows = visibleDisputes.map((d) =>
      [
        esc(orderLabel(d)),
        formatShortId(d.id),
        esc(d.customer_display_name ?? ""),
        formatCurrency(d.amount, d.currency_code, numberLocale),
        esc(translateReason(d.reason, t)),
        esc(translateFamily(d.reason, t)),
        d.phase ?? "",
        statusLabelForCsv(d.status),
        d.normalized_status ?? "",
        d.submission_state ?? "",
        formatDueDate(d.due_at),
        formatDueDate(d.submitted_at ?? null),
        formatDueDate(d.closed_at ?? null),
        d.final_outcome ?? "",
        d.outcome_amount_recovered != null ? String(d.outcome_amount_recovered) : "",
        d.outcome_amount_lost != null ? String(d.outcome_amount_lost) : "",
        formatDueDate(d.last_event_at ?? null),
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

  // Compute summary counts from visible disputes
  const summaryInquiries = disputes.filter((d) => d.phase === "inquiry").length;
  const summaryChargebacks = disputes.filter((d) => d.phase === "chargeback").length;
  const summaryNeedsReview = disputes.filter((d) => d.needs_review).length;
  const summaryNeedsSync = disputes.filter((d) => !d.phase).length;
  const summaryUrgent = disputes.filter((d) => {
    if (!d.due_at) return false;
    const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursLeft <= 48;
  }).length;

  // Plain-language state sentence — priority order surfaces the biggest blocker first
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

  // Compute urgency for a dispute
  function getUrgency(d: Dispute): { label: string; tone: "critical" | "warning" | "attention" | "success" | undefined } {
    if (d.due_at) {
      const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursLeft < 0) return { label: t("disputes.urgencyOverdue"), tone: "critical" };
      if (hoursLeft <= 48) return { label: t("disputes.urgencyUrgent"), tone: "warning" };
    }
    if (d.needs_review) return { label: t("disputes.urgencyReview"), tone: "attention" };
    return { label: t("disputes.urgencyOnTrack"), tone: "success" };
  }

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
            {/* Current state — plain language */}
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

            {/* Needs review banner */}
            {!loading && summaryNeedsReview > 0 && (
              <Banner tone="warning">
                <p>{t("disputes.needsReviewBanner", { count: summaryNeedsReview })}</p>
              </Banner>
            )}

            {/* Nudge: enable email alerts when teamEmail is not configured */}
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

            {/* Tabs: Active / Closed / All */}
            <InlineStack gap="200">
              {(["active", "closed", "all"] as const).map((tab) => (
                <Button
                  key={tab}
                  pressed={activeTab === tab}
                  onClick={() => { setActiveTab(tab); setPage(1); }}
                  size="slim"
                >
                  {t(`disputes.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
                </Button>
              ))}
            </InlineStack>

            {/* Actions bar */}
            <Card>
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

                <Popover
                  active={filterPopoverActive}
                  activator={
                    <Button
                      icon={FilterIcon}
                      onClick={() => setFilterPopoverActive((v) => !v)}
                    >
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

                <Button icon={ExportIcon} onClick={exportCsv}>
                  {t("disputes.export")}
                </Button>
              </InlineStack>
            </Card>

            {/* Table */}
            <Card padding="0">
              {loading ? (
                <div className={styles.loadingWrap}>
                  <Spinner size="large" />
                </div>
              ) : visibleDisputes.length === 0 ? (
                <Box padding="500">
                  <Text as="p" tone="subdued">
                    {disputes.length === 0
                      ? t("disputes.noDisputes")
                      : t("disputes.noMatchingDisputes")}
                  </Text>
                </Box>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.listTable}>
                    <thead>
                      <tr>
                        <th>{t("disputes.phaseLabel")}</th>
                        <th>{t("table.order")}</th>
                        <th>{t("table.customer")}</th>
                        <th>{t("table.reason")}</th>
                        <th>{t("table.amount")}</th>
                        <th>{t("table.status")}</th>
                        {activeTab === "closed" ? (
                          <>
                            <th>{t("disputes.columnOutcome")}</th>
                            <th>{t("disputes.columnClosedAt")}</th>
                          </>
                        ) : (
                          <th>{t("table.urgency")}</th>
                        )}
                        <th>{t("table.date")}</th>
                        <th>{t("table.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDisputes.map((d) => {
                        const label = orderLabel(d);
                        const detailHref = withShopParams(`/app/disputes/${d.id}`, searchParams);
                        const urgency = getUrgency(d);
                        const ns = d.normalized_status;
                        return (
                          <tr key={d.id}>
                            {/* Phase */}
                            <td>
                              <Badge tone={phaseBadgeTone(d.phase as "inquiry" | "chargeback" | null)}>
                                {phaseLabelFn(d.phase as "inquiry" | "chargeback" | null, t)}
                              </Badge>
                            </td>
                            {/* Order */}
                            <td>
                              <Text as="span" variant="bodySm" fontWeight="semibold">{label}</Text>
                            </td>
                            {/* Customer */}
                            <td>
                              <Text as="span" variant="bodySm">
                                {d.customer_display_name ?? "—"}
                              </Text>
                            </td>
                            {/* Reason / Family */}
                            <td>
                              <span className={styles.cellMuted}>
                                {translateReason(d.reason, t)}
                              </span>
                            </td>
                            {/* Amount */}
                            <td>
                              <span className={styles.cellAmount}>
                                {formatCurrency(d.amount, d.currency_code, numberLocale)}
                              </span>
                            </td>
                            {/* Normalized Status */}
                            <td>
                              <Badge tone={ns ? NORMALIZED_STATUS_TONE[ns] : badgeTone(d.status)}>
                                {ns
                                  ? t(`disputeTimeline.normalizedStatuses.${ns}`)
                                  : badgeLabel(d.status)}
                              </Badge>
                            </td>
                            {activeTab === "closed" ? (
                              <>
                                {/* Final Outcome */}
                                <td>
                                  {d.final_outcome ? (
                                    <Badge tone={OUTCOME_TONE[d.final_outcome]}>
                                      {t(`disputeTimeline.outcomes.${d.final_outcome}`)}
                                    </Badge>
                                  ) : (
                                    <span className={styles.cellMuted}>—</span>
                                  )}
                                </td>
                                {/* Closed At */}
                                <td>
                                  <span className={styles.cellMuted}>
                                    {formatDueDate(d.closed_at ?? null)}
                                  </span>
                                </td>
                              </>
                            ) : (
                              <td>
                                <Badge tone={urgency.tone}>{urgency.label}</Badge>
                              </td>
                            )}
                            {/* Date */}
                            <td>
                              <span className={styles.cellMuted}>
                                {d.initiated_at ? new Date(d.initiated_at).toLocaleString(dateLocale, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                              </span>
                            </td>
                            {/* Actions */}
                            <td>
                              <Link href={detailHref} style={recentDisputesViewDetailsLinkStyle}>
                                {t("table.viewDetails")}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Pagination */}
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

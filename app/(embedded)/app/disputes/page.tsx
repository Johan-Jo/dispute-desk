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
import { shopifyOrderAdminUrl } from "@/lib/embedded/shopifyOrderUrl";
import { recentDisputesViewDetailsLinkStyle } from "@/lib/embedded/recentDisputesTableStyles";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  Popover,
  ActionList,
  ChoiceList,
  Box,
  Spinner,
  InlineStack,
  Pagination,
  Icon,
  Badge,
  BlockStack,
  Text,
} from "@shopify/polaris";
import {
  SearchIcon,
  FilterIcon,
  ExportIcon,
  RefreshIcon,
  MenuHorizontalIcon,
  AlertTriangleIcon,
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
  needs_review: boolean;
  last_synced_at: string | null;
}

interface DisputesResponse {
  disputes: Dispute[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

function isSyntheticDispute(disputeGid: string): boolean {
  return disputeGid?.includes("/seed-") ?? false;
}

function formatReasonTitleCase(reason: string | null): string {
  if (!reason) return "—";
  return reason
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

  /** Dashboard Recent Disputes: short month + day only */
  const formatDeadlineShort = useCallback(
    (iso: string | null) => {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString(dateLocale, {
        month: "short",
        day: "numeric",
      });
    },
    [dateLocale],
  );

  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({
    total: 0,
    total_pages: 0,
  });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);
  const [moreMenuActive, setMoreMenuActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/usage")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { shop_domain?: string | null }) => {
        if (!cancelled) setShopDomain(d.shop_domain ?? null);
      });
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
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, phaseFilter]);

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
    const rows = visibleDisputes.map((d) =>
      [
        orderLabel(d),
        formatShortId(d.id),
        d.customer_display_name ?? "",
        formatCurrency(d.amount, d.currency_code, numberLocale),
        formatReasonTitleCase(d.reason),
        DISPUTE_REASON_FAMILIES[d.reason as AllDisputeReasonCode] ?? "",
        d.phase ?? "",
        statusLabelForCsv(d.status),
        formatDueDate(d.due_at),
      ].join(","),
    );
    const csv = [
      "Order,ID,Customer,Amount,Reason,Family,Phase,Status,Due date",
      ...rows,
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "disputes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Page
      title={t("disputes.title")}
      subtitle={t("disputes.manageSubtitle")}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
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
                  <Box padding="400" minWidth="240px">
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
                        title={t("table.status")}
                        choices={[
                          { label: t("status.needsResponse"), value: "needs_response" },
                          { label: t("status.underReview"), value: "under_review" },
                          { label: t("status.won"), value: "won" },
                          { label: t("status.lost"), value: "lost" },
                        ]}
                        selected={statusFilter}
                        onChange={(v) => {
                          setStatusFilter(v);
                          setPage(1);
                        }}
                        allowMultiple
                      />
                    </BlockStack>
                  </Box>
                </Popover>

                <Button icon={ExportIcon} onClick={exportCsv}>
                  {t("disputes.export")}
                </Button>

                <Popover
                  active={moreMenuActive}
                  activator={
                    <Button
                      variant="secondary"
                      icon={MenuHorizontalIcon}
                      onClick={() => setMoreMenuActive((a) => !a)}
                      accessibilityLabel={t("disputes.moreActions")}
                    />
                  }
                  onClose={() => setMoreMenuActive(false)}
                  preferredAlignment="right"
                  autofocusTarget="first-node"
                >
                  <ActionList
                    actionRole="menuitem"
                    items={[
                      {
                        content: syncing ? t("disputes.syncing") : t("disputes.syncNow"),
                        icon: RefreshIcon,
                        disabled: syncing,
                        onAction: () => {
                          setMoreMenuActive(false);
                          void handleSync();
                        },
                      },
                    ]}
                  />
                </Popover>
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
                        <th>{t("table.order")}</th>
                        <th>{t("table.id")}</th>
                        <th>{t("table.customer")}</th>
                        <th>{t("table.amount")}</th>
                        <th>{t("table.reason")}</th>
                        <th>{t("disputes.phaseLabel")}</th>
                        <th>{t("table.status")}</th>
                        <th>{t("table.deadline")}</th>
                        <th>{t("table.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDisputes.map((d) => {
                        const orderUrl = shopifyOrderAdminUrl(shopDomain, d.order_gid);
                        const label = orderLabel(d);
                        const detailHref = withShopParams(`/app/disputes/${d.id}`, searchParams);
                        return (
                          <tr key={d.id}>
                            <td>
                              {orderUrl ? (
                                <a
                                  href={orderUrl}
                                  target="_top"
                                  rel="noopener noreferrer"
                                  className={styles.cellOrder}
                                >
                                  {label}
                                </a>
                              ) : (
                                <span className={styles.cellId}>{label}</span>
                              )}
                            </td>
                            <td>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatShortId(d.id)}
                              </Text>
                              {isSyntheticDispute(d.dispute_gid) && (
                                <span className={styles.syntheticBadge}>
                                  Synthetic
                                </span>
                              )}
                            </td>
                            <td>
                              <Text
                                as="span"
                                variant="bodySm"
                                tone={d.customer_display_name ? undefined : "subdued"}
                              >
                                {d.customer_display_name ?? "—"}
                              </Text>
                            </td>
                            <td>
                              <span className={styles.cellAmount}>
                                {formatCurrency(d.amount, d.currency_code, numberLocale)}
                              </span>
                            </td>
                            <td>
                              <BlockStack gap="050">
                                <span className={styles.cellMuted}>
                                  {formatReasonTitleCase(d.reason)}
                                </span>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {DISPUTE_REASON_FAMILIES[d.reason as AllDisputeReasonCode] ?? ""}
                                </Text>
                              </BlockStack>
                            </td>
                            <td>
                              {d.phase ? (
                                <Badge tone={phaseBadgeTone(d.phase as "inquiry" | "chargeback")}>
                                  {phaseLabelFn(d.phase as "inquiry" | "chargeback", t)}
                                </Badge>
                              ) : (
                                <Text as="span" variant="bodySm" tone="subdued">—</Text>
                              )}
                            </td>
                            <td>
                              <Badge tone={badgeTone(d.status)}>
                                {badgeLabel(d.status)}
                              </Badge>
                            </td>
                            <td>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatDeadlineShort(d.due_at)}
                              </Text>
                            </td>
                            <td>
                              <InlineStack gap="200" blockAlign="center" wrap={false}>
                                {d.needs_review && (
                                  <Icon source={AlertTriangleIcon} tone="warning" />
                                )}
                                <Link href={detailHref} style={recentDisputesViewDetailsLinkStyle}>
                                  {t("table.viewDetails")}
                                </Link>
                              </InlineStack>
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

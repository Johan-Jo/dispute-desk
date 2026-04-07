/**
 * Embedded disputes list — Figma-aligned: one Card (toolbar + table), columns
 * Dispute ID → Order → Reason → Amount → Status → Due date → chevron; row opens detail.
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import { shopifyOrderAdminUrl } from "@/lib/embedded/shopifyOrderUrl";
import styles from "./disputes-list.module.css";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  ChoiceList,
  Button,
  Spinner,
  InlineStack,
  BlockStack,
  Box,
  Icon,
  TextField,
  Popover,
} from "@shopify/polaris";
import { ExportIcon, SearchIcon, FilterIcon, RefreshIcon, ChevronRightIcon } from "@shopify/polaris-icons";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
  order_name?: string | null;
  customer_display_name?: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  due_at: string | null;
  needs_review: boolean;
  last_synced_at: string | null;
}

interface DisputesResponse {
  disputes: Dispute[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
}

function isSyntheticDispute(disputeGid: string): boolean {
  return disputeGid?.includes("/seed-") ?? false;
}

function formatReasonTitleCase(reason: string | null): string {
  if (!reason) return "—";
  return reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(amount: number | null, code: string | null, locale: string): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

function shortDisputeId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** Figma-style ref e.g. DP-6984 (first 4 hex chars of UUID, no dashes). */
function formatListDisputeId(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `DP-${hex}`;
}

function orderLabel(d: Dispute): string {
  return d.order_name ?? (d.order_gid ? `#${String(d.order_gid).slice(-4)}` : "—");
}

export default function DisputesListPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
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
    [dateLocale]
  );

  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);

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
      const params = new URLSearchParams({ page: String(page), per_page: "25" });
      if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

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

  const goToDispute = useCallback(
    (id: string) => {
      router.push(withShopParams(`/app/disputes/${id}`, searchParams));
    },
    [router, searchParams]
  );

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

  /** Figma-style badges: Open (neutral), In review (warning/amber), Won, Lost. */
  const renderStatusBadge = (status: string | null) => {
    if (!status) return <Badge>{t("disputes.statusUnknown")}</Badge>;
    switch (status) {
      case "needs_response":
        return <Badge>{t("disputes.statusOpen")}</Badge>;
      case "under_review":
        return <Badge tone="warning">{t("disputes.statusUnderReview")}</Badge>;
      case "charge_refunded":
      case "won":
        return <Badge tone="success">{t("disputes.statusWon")}</Badge>;
      case "lost":
        return <Badge tone="critical">{t("disputes.statusLost")}</Badge>;
      default:
        return <Badge>{status.replace(/_/g, " ")}</Badge>;
    }
  };

  const visibleDisputes = queryValue
    ? disputes.filter((d) => {
        const q = queryValue.toLowerCase();
        const sid = shortDisputeId(d.id).toLowerCase();
        const dp = formatListDisputeId(d.id).toLowerCase();
        return (
          d.dispute_gid.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q) ||
          sid.includes(q) ||
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
        formatListDisputeId(d.id),
        orderLabel(d),
        formatReasonTitleCase(d.reason),
        formatCurrency(d.amount, d.currency_code, numberLocale),
        statusLabelForCsv(d.status),
        formatDueDate(d.due_at),
      ].join(",")
    );
    const csv = ["Dispute ID,Order,Reason,Amount,Status,Due date", ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "disputes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filterActivator = (
    <Button
      variant="secondary"
      icon={FilterIcon}
      onClick={() => setFilterPopoverActive((v) => !v)}
    >
      {t("common.filter")}
    </Button>
  );

  const filterContent = (
    <Box padding="400" minWidth="240px">
      <ChoiceList
        title={t("table.status")}
        titleHidden
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
    </Box>
  );

  const tableBodyMarkup = visibleDisputes.map((d) => {
    const orderUrl = shopifyOrderAdminUrl(shopDomain, d.order_gid);
    const label = orderLabel(d);
    return (
      <tr
        key={d.id}
        role="link"
        tabIndex={0}
        aria-label={t("disputes.viewDetails")}
        style={{ cursor: "pointer" }}
        onClick={() => goToDispute(d.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goToDispute(d.id);
          }
        }}
      >
        <td>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {formatListDisputeId(d.id)}
            </Text>
            {isSyntheticDispute(d.dispute_gid) && <Badge tone="info">Synthetic</Badge>}
          </InlineStack>
        </td>
        <td>
          {orderUrl ? (
            <a
              href={orderUrl}
              target="_top"
              rel="noopener noreferrer"
              className={styles.orderAdminLink}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {label}
            </a>
          ) : (
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {label}
            </Text>
          )}
        </td>
        <td>
          <Text as="span" variant="bodySm" tone="subdued">
            {formatReasonTitleCase(d.reason)}
          </Text>
        </td>
        <td>
          <Text as="span" variant="bodySm" fontWeight="semibold">
            {formatCurrency(d.amount, d.currency_code, numberLocale)}
          </Text>
        </td>
        <td>{renderStatusBadge(d.status)}</td>
        <td>
          <Text as="span" variant="bodySm" tone="subdued">
            {formatDueDate(d.due_at)}
          </Text>
        </td>
        <td className={styles.chevronCol}>
          <Icon source={ChevronRightIcon} tone="subdued" />
        </td>
      </tr>
    );
  });

  return (
    <Page title={t("disputes.title")} subtitle={t("disputes.manageSubtitle")}>
      <div className={styles.constrain}>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <div className={styles.mainCard}>
                <Card>
                  <Box padding="400" paddingBlockEnd={loading || visibleDisputes.length === 0 ? "400" : "300"}>
                    <InlineStack gap="300" wrap={false} blockAlign="center">
                      <div style={{ flex: 1, minWidth: "12rem" }}>
                        <TextField
                          label={t("disputes.searchPlaceholder")}
                          labelHidden
                          value={queryValue}
                          onChange={setQueryValue}
                          placeholder={t("disputes.searchPlaceholder")}
                          autoComplete="off"
                          clearButton
                          onClearButtonClick={() => setQueryValue("")}
                          prefix={<Icon source={SearchIcon} tone="subdued" />}
                        />
                      </div>
                      <Popover
                        active={filterPopoverActive}
                        activator={filterActivator}
                        onClose={() => setFilterPopoverActive(false)}
                        autofocusTarget="none"
                      >
                        {filterContent}
                      </Popover>
                      <Button variant="secondary" icon={ExportIcon} onClick={exportCsv}>
                        {t("disputes.export")}
                      </Button>
                      <Button
                        variant="tertiary"
                        icon={RefreshIcon}
                        onClick={handleSync}
                        loading={syncing}
                      >
                        {syncing ? t("disputes.syncing") : t("disputes.syncNow")}
                      </Button>
                    </InlineStack>
                  </Box>

                  {loading ? (
                    <Box padding="600">
                      <BlockStack gap="400" inlineAlign="center">
                        <Spinner size="large" />
                      </BlockStack>
                    </Box>
                  ) : visibleDisputes.length === 0 ? (
                    <Box paddingInline="400" paddingBlockEnd="400">
                      <Text as="p" variant="bodyMd" tone="subdued">
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
                            <th>{t("table.disputeId")}</th>
                            <th>{t("table.order")}</th>
                            <th>{t("table.reason")}</th>
                            <th>{t("table.amount")}</th>
                            <th>{t("table.status")}</th>
                            <th>{t("table.dueDateColumn")}</th>
                            <th className={styles.chevronCol} aria-hidden />
                          </tr>
                        </thead>
                        <tbody>{tableBodyMarkup}</tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              {pagination.total_pages > 1 && (
                <div style={{ padding: "1rem", display: "flex", justifyContent: "center" }}>
                  <InlineStack gap="300">
                    <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      {t("common.previous")}
                    </Button>
                    <Text as="span" variant="bodySm">
                      {t("common.page", { page, total: pagination.total_pages })}
                    </Text>
                    <Button
                      disabled={page >= pagination.total_pages}
                      onClick={() => setPage(page + 1)}
                    >
                      {t("common.next")}
                    </Button>
                  </InlineStack>
                </div>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>
      </div>
    </Page>
  );
}

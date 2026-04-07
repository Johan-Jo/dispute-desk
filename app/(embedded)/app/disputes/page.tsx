/**
 * Figma Make source: ShopifyDisputes (lucide + Tailwind reference).
 * Route: app/(embedded)/app/disputes/page.tsx
 * Layout: title + subtitle, toolbar card (search, Filter, Export, Sync), table card
 * (columns: Dispute ID, Order, Reason, Amount, Status, Due date, chevron).
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
import styles from "./disputes-list.module.css";
import {
  Page,
  Layout,
  Card,
  IndexTable,
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
import {
  ChevronRightIcon,
  ExportIcon,
  SearchIcon,
  FilterIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";

interface Dispute {
  id: string;
  dispute_gid: string;
  order_gid: string | null;
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

function statusTone(
  status: string | null
): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "won":
      return "success";
    case "needs_response":
    case "under_review":
      return "warning";
    case "lost":
      return "critical";
    default:
      return "info";
  }
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

/** Title case for display (Figma mock: "Fraudulent", "Product not received"). */
function formatReason(reason: string | null): string {
  if (!reason?.trim()) return "";
  const words = reason.replace(/_/g, " ").toLowerCase().split(/\s+/).filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function isPastDue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

export default function DisputesListPage() {
  const router = useRouter();
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

  const formatDisputeDate = useCallback(
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
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);

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

  const statusLabel = (status: string | null): string => {
    switch (status) {
      case "needs_response":
        return t("status.needsResponse");
      case "under_review":
        return t("status.underReview");
      case "won":
        return t("status.won");
      case "lost":
        return t("status.lost");
      default:
        return t("status.unknown");
    }
  };

  const disputeIdDisplay = (d: Dispute): string => {
    const last = d.dispute_gid.split("/").pop();
    return last ?? d.id.slice(0, 12);
  };

  const visibleDisputes = queryValue
    ? disputes.filter((d) => {
        const q = queryValue.toLowerCase();
        return (
          d.dispute_gid.toLowerCase().includes(q) ||
          (d.reason ?? "").toLowerCase().includes(q) ||
          (d.order_gid ?? "").toLowerCase().includes(q)
        );
      })
    : disputes;

  const exportCsv = () => {
    const rows = visibleDisputes.map((d) =>
      [
        disputeIdDisplay(d),
        d.order_gid ? `#${String(d.order_gid).slice(-6)}` : "",
        formatReason(d.reason) || (d.reason ?? ""),
        formatCurrency(d.amount, d.currency_code),
        statusLabel(d.status),
        formatDisputeDate(d.due_at),
      ].join(",")
    );
    const csv = ["ID,Order,Reason,Amount,Status,Due Date", ...rows].join("\n");
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

  const rowMarkup = visibleDisputes.map((d, idx) => {
    const overdue = isPastDue(d.due_at);
    const reasonText = formatReason(d.reason);
    return (
      <IndexTable.Row
        id={d.id}
        key={d.id}
        position={idx}
        onClick={() => router.push(withShopParams(`/app/disputes/${d.id}`, searchParams))}
      >
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {disputeIdDisplay(d)}
            </Text>
            {isSyntheticDispute(d.dispute_gid) && <Badge tone="info">Synthetic</Badge>}
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <span className={styles.orderLink}>
            {d.order_gid ? `#${String(d.order_gid).slice(-6)}` : "—"}
          </span>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <span className={styles.reasonMuted}>{reasonText || t("status.unknown")}</span>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <span className={styles.amountEmphasis}>{formatCurrency(d.amount, d.currency_code)}</span>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <span className={overdue ? styles.dueOverdue : styles.dueDeadline}>
            {formatDisputeDate(d.due_at)}
          </span>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Icon source={ChevronRightIcon} tone="subdued" />
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page title={t("disputes.title")} subtitle={t("disputes.manageSubtitle")}>
      <div className={styles.constrain}>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <div className={styles.toolbarCard}>
                <Card>
                  <Box padding="400">
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
                        variant="secondary"
                        icon={RefreshIcon}
                        onClick={handleSync}
                        loading={syncing}
                      >
                        {syncing ? t("disputes.syncing") : t("disputes.syncNow")}
                      </Button>
                    </InlineStack>
                  </Box>
                </Card>
              </div>

              <div className={`${styles.tableCard} ${styles.tableFigma}`}>
                <Card padding="0">
                  {loading ? (
                    <div style={{ padding: "2rem", textAlign: "center" }}>
                      <Spinner size="large" />
                    </div>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "dispute", plural: "disputes" }}
                      itemCount={visibleDisputes.length}
                      headings={[
                        { title: t("table.disputeId") },
                        { title: t("table.order") },
                        { title: t("table.reason") },
                        { title: t("table.amount") },
                        { title: t("table.status") },
                        { title: t("disputes.dueDate") },
                        { title: "" },
                      ]}
                      selectable={false}
                    >
                      {rowMarkup}
                    </IndexTable>
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

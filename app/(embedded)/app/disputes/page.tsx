/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/disputes/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-disputes.tsx
 * Pill tabs, search + add-filter, Export + Sync Now, table (ID, Order, Reason, Amount, Status, Due date + overdue, chevron).
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { withShopParams } from "@/lib/withShopParams";
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
import { ChevronRightIcon, ExportIcon, SearchIcon } from "@shopify/polaris-icons";
import styles from "./disputes-list.module.css";

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

function formatReason(reason: string | null): string {
  if (!reason?.trim()) return "";
  return reason.replace(/_/g, " ").toUpperCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isPastDue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

export default function DisputesListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tab, setTab] = useState<"all" | "review">("all");
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });
  const [filterPopoverActive, setFilterPopoverActive] = useState(false);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: "25" });
      if (tab === "review") params.set("needs_review", "true");
      if (statusFilter.length > 0) params.set("status", statusFilter.join(","));
      const res = await fetch(`/api/disputes?${params}`);
      const json: DisputesResponse = await res.json();
      setDisputes(json.disputes ?? []);
      setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, tab]);

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

  const handleApprove = async (disputeId: string) => {
    await fetch(`/api/disputes/${disputeId}/approve`, { method: "POST" });
    await fetchDisputes();
  };

  const daysUntil = (iso: string | null): string => {
    if (!iso) return "—";
    const diff = Math.ceil(
      (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (diff < 0) return t("common.overdue");
    if (diff === 0) return t("common.today");
    return t("common.daysRemaining", { count: diff });
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
        formatDate(d.due_at),
      ].join(",")
    );
    const csv = [
      "ID,Order,Reason,Amount,Status,Due Date",
      ...rows,
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "disputes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filterActivator = (
    <Button variant="plain" onClick={() => setFilterPopoverActive((v) => !v)}>
      {t("disputes.addFilter")}
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
          <Text as="span" variant="bodyMd" tone="subdued">
            {d.order_gid ? `#${String(d.order_gid).slice(-6)}` : "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {reasonText || t("status.unknown")}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {formatCurrency(d.amount, d.currency_code)}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusTone(d.status)}>{statusLabel(d.status)}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm">
              {formatDate(d.due_at)}
            </Text>
            {overdue && d.due_at ? (
              <Text as="span" variant="bodySm" tone="critical">
                {t("common.overdue")}
              </Text>
            ) : d.due_at ? (
              <Text as="span" variant="bodySm" tone="subdued">
                {daysUntil(d.due_at)}
              </Text>
            ) : null}
          </BlockStack>
        </IndexTable.Cell>
        {tab === "review" && (
          <IndexTable.Cell>
            <Button size="micro" onClick={() => handleApprove(d.id)}>
              {t("disputes.approve")}
            </Button>
          </IndexTable.Cell>
        )}
        <IndexTable.Cell>
          <Icon source={ChevronRightIcon} tone="subdued" />
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title={t("disputes.title")}
      subtitle={t("disputes.manageSubtitle")}
      primaryAction={{
        content: syncing ? t("disputes.syncing") : t("disputes.syncNow"),
        onAction: handleSync,
        loading: syncing,
      }}
      secondaryActions={[
        {
          content: t("disputes.export"),
          icon: ExportIcon,
          onAction: exportCsv,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Box paddingInline="400" paddingBlockStart="400" paddingBlockEnd="300">
              <div className={styles.tabGroup} role="tablist" aria-label={t("disputes.title")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "all"}
                  className={`${styles.tabPill} ${tab === "all" ? styles.tabPillActive : ""}`}
                  onClick={() => {
                    setTab("all");
                    setPage(1);
                  }}
                >
                  {t("disputes.allDisputes")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "review"}
                  className={`${styles.tabPill} ${tab === "review" ? styles.tabPillActive : ""}`}
                  onClick={() => {
                    setTab("review");
                    setPage(1);
                  }}
                >
                  {t("disputes.reviewQueue")}
                </button>
              </div>
            </Box>

            <div className={styles.searchCardInner}>
              <Box paddingInline="400" paddingBlock="300">
                <BlockStack gap="200">
                  <TextField
                    label={t("common.search")}
                    labelHidden
                    value={queryValue}
                    onChange={setQueryValue}
                    placeholder={t("common.search")}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setQueryValue("")}
                    prefix={<Icon source={SearchIcon} tone="subdued" />}
                  />
                  <Popover
                    active={filterPopoverActive}
                    activator={filterActivator}
                    onClose={() => setFilterPopoverActive(false)}
                    autofocusTarget="none"
                  >
                    {filterContent}
                  </Popover>
                </BlockStack>
              </Box>
            </div>

            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            ) : (
              <IndexTable
                resourceName={{ singular: "dispute", plural: "disputes" }}
                itemCount={visibleDisputes.length}
                headings={[
                  { title: t("table.id") },
                  { title: t("table.order") },
                  { title: t("table.reason") },
                  { title: t("table.amount") },
                  { title: t("table.status") },
                  { title: t("disputes.dueDate") },
                  ...(tab === "review" ? [{ title: t("table.action") }] : []),
                  { title: "" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>

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
        </Layout.Section>
      </Layout>
    </Page>
  );
}

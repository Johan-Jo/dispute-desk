/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/disputes/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-disputes.tsx
 * Reference: header "View and manage all your chargebacks and disputes", search bar,
 * Filter + Export actions, table (ID, Order, Reason, Amount, Status, Due Date, chevron).
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Filters,
  ChoiceList,
  Button,
  Spinner,
  InlineStack,
  BlockStack,
} from "@shopify/polaris";

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

function statusTone(status: string | null): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "won": return "success";
    case "needs_response": case "under_review": return "warning";
    case "lost": return "critical";
    default: return "info";
  }
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code ?? "USD" }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DisputesListPage() {
  const router = useRouter();
  const t = useTranslations();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tab, setTab] = useState<"all" | "review">("all");
  const [queryValue, setQueryValue] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });

  // Shop is resolved server-side: middleware forwards session cookies and sets x-shop-id on /api/* (shopify_shop_id is httpOnly — not readable from document.cookie).
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

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

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
    const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return t("common.overdue");
    if (diff === 0) return t("common.today");
    return t("common.daysRemaining", { count: diff });
  };

  const filters = [
    {
      key: "status",
      label: t("table.status"),
      filter: (
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
          onChange={setStatusFilter}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

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

  const rowMarkup = visibleDisputes.map((d, idx) => (
    <IndexTable.Row
      id={d.id}
      key={d.id}
      position={idx}
      onClick={() => router.push(`/app/disputes/${d.id}`)}
    >
      <IndexTable.Cell>
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {d.dispute_gid.split("/").pop()?.slice(0, 8) ?? d.id.slice(0, 8)}
          </Text>
          {isSyntheticDispute(d.dispute_gid) && <Badge tone="info">Synthetic</Badge>}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" tone="subdued">
          {d.order_gid ? `#${String(d.order_gid).slice(-6)}` : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{d.reason ?? t("status.unknown")}</IndexTable.Cell>
      <IndexTable.Cell>{formatCurrency(d.amount, d.currency_code)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusTone(d.status)}>
          {(d.status ?? "unknown").replace(/_/g, " ")}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodySm">{formatDate(d.due_at)}</Text>
          <Text as="span" variant="bodySm" tone={daysUntil(d.due_at) === t("common.overdue") ? "critical" : "subdued"}>
            {daysUntil(d.due_at)}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      {tab === "review" && (
        <IndexTable.Cell>
          <Button size="micro" onClick={() => handleApprove(d.id)}>
            {t("disputes.approve")}
          </Button>
        </IndexTable.Cell>
      )}
    </IndexTable.Row>
  ));

  return (
    <Page
      title={t("disputes.title")}
      subtitle={t("disputes.manageSubtitle")}
      primaryAction={{
        content: syncing ? t("disputes.syncing") : t("disputes.syncNow"),
        onAction: handleSync,
        loading: syncing,
      }}
    >
      <Layout>
        <Layout.Section>
          <InlineStack gap="200">
            <Button
              variant={tab === "all" ? "primary" : "secondary"}
              onClick={() => { setTab("all"); setPage(1); }}
            >
              {t("disputes.allDisputes")}
            </Button>
            <Button
              variant={tab === "review" ? "primary" : "secondary"}
              onClick={() => { setTab("review"); setPage(1); }}
            >
              {t("disputes.reviewQueue")}
            </Button>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Filters
              queryValue={queryValue}
              filters={filters}
              onQueryChange={setQueryValue}
              onQueryClear={() => setQueryValue("")}
              onClearAll={() => { setStatusFilter([]); setQueryValue(""); }}
              queryPlaceholder={t("common.search")}
            />
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
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.previous")}</Button>
                <Text as="span" variant="bodySm">
                  {t("common.page", { page, total: pagination.total_pages })}
                </Text>
                <Button disabled={page >= pagination.total_pages} onClick={() => setPage(page + 1)}>
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

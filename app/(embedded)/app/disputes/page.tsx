"use client";

import { useState, useEffect, useCallback } from "react";
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
  useIndexResourceState,
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
  last_synced_at: string | null;
}

interface DisputesResponse {
  disputes: Dispute[];
  pagination: { page: number; per_page: number; total: number; total_pages: number };
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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code ?? "USD",
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.ceil(
    (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return "Overdue";
  if (diff === 0) return "Today";
  return `${diff}d`;
}

export default function DisputesListPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0 });

  const shopId = typeof window !== "undefined"
    ? document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? ""
    : "";

  const fetchDisputes = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const params = new URLSearchParams({ shop_id: shopId, page: String(page), per_page: "25" });
    if (statusFilter.length > 0) params.set("status", statusFilter.join(","));

    const res = await fetch(`/api/disputes?${params}`);
    const json: DisputesResponse = await res.json();
    setDisputes(json.disputes ?? []);
    setPagination(json.pagination ?? { total: 0, total_pages: 0 });
    setLoading(false);
  }, [shopId, page, statusFilter]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/disputes/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId }),
    });
    await fetchDisputes();
    setSyncing(false);
  };

  const resourceName = { singular: "dispute", plural: "disputes" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(disputes as unknown as { [key: string]: unknown }[]);

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "Needs response", value: "needs_response" },
            { label: "Under review", value: "under_review" },
            { label: "Won", value: "won" },
            { label: "Lost", value: "lost" },
          ]}
          selected={statusFilter}
          onChange={setStatusFilter}
          allowMultiple
        />
      ),
      shortcut: true,
    },
  ];

  const rowMarkup = disputes.map((d, idx) => (
    <IndexTable.Row
      id={d.id}
      key={d.id}
      position={idx}
      selected={selectedResources.includes(d.id)}
      onClick={() => {
        window.location.href = `/app/disputes/${d.id}`;
      }}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {d.dispute_gid.split("/").pop()?.slice(0, 8) ?? d.id.slice(0, 8)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{d.reason ?? "Unknown"}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusTone(d.status)}>
          {(d.status ?? "unknown").replace(/_/g, " ")}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatCurrency(d.amount, d.currency_code)}</IndexTable.Cell>
      <IndexTable.Cell>{formatDate(d.due_at)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={daysUntil(d.due_at) === "Overdue" ? "critical" : undefined}>
          {daysUntil(d.due_at)}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(d.last_synced_at)}</IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Disputes"
      subtitle={`${pagination.total} total`}
      primaryAction={{
        content: syncing ? "Syncing..." : "Sync Now",
        onAction: handleSync,
        loading: syncing,
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Filters
              queryValue=""
              filters={filters}
              onQueryChange={() => {}}
              onQueryClear={() => {}}
              onClearAll={() => setStatusFilter([])}
            />
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={disputes.length}
                selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "ID" },
                  { title: "Reason" },
                  { title: "Status" },
                  { title: "Amount" },
                  { title: "Due Date" },
                  { title: "Remaining" },
                  { title: "Last Synced" },
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
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Text as="span" variant="bodySm">
                  Page {page} of {pagination.total_pages}
                </Text>
                <Button disabled={page >= pagination.total_pages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </InlineStack>
            </div>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

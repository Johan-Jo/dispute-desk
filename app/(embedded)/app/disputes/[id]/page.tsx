"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Banner,
  Button,
  Spinner,
  Divider,
  DataTable,
} from "@shopify/polaris";

interface Dispute {
  id: string;
  dispute_gid: string;
  dispute_evidence_gid: string | null;
  order_gid: string | null;
  status: string | null;
  reason: string | null;
  amount: number | null;
  currency_code: string | null;
  initiated_at: string | null;
  due_at: string | null;
  last_synced_at: string | null;
  needs_review: boolean;
}

interface Pack {
  id: string;
  status: string;
  completeness_score: number | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  saved_to_shopify_at: string | null;
  created_at: string;
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
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.ceil(
    (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  return `${diff} days remaining`;
}

function packStatusTone(status: string): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "saved_to_shopify": return "success";
    case "ready": return "warning";
    case "blocked": case "failed": return "critical";
    case "building": case "queued": return "info";
    default: return undefined;
  }
}

export default function DisputeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/disputes/${id}`);
    const json = await res.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch(`/api/disputes/${id}/sync`, { method: "POST" });
    await fetchData();
    setSyncing(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    await fetch(`/api/disputes/${id}/packs`, { method: "POST" });
    await fetchData();
    setGenerating(false);
  };

  if (loading) {
    return (
      <Page title="Dispute">
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!dispute) {
    return (
      <Page title="Dispute" backAction={{ content: "Disputes", url: "/app/disputes" }}>
        <Banner tone="critical">Dispute not found.</Banner>
      </Page>
    );
  }

  const orderNum = dispute.order_gid?.split("/").pop();
  const shopDomain =
    typeof window !== "undefined"
      ? document.cookie.match(/shopify_shop=([^;]+)/)?.[1]
      : null;

  return (
    <Page
      title={`Dispute ${dispute.dispute_gid.split("/").pop()}`}
      backAction={{ content: "Disputes", url: "/app/disputes" }}
      primaryAction={{
        content: generating ? "Generating..." : "Generate Pack",
        onAction: handleGenerate,
        loading: generating,
      }}
      secondaryActions={[
        {
          content: syncing ? "Syncing..." : "Re-sync",
          onAction: handleSync,
          loading: syncing,
        },
      ]}
    >
      <Layout>
        {/* Summary card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Summary</Text>
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Status</Text>
                  <Badge tone={dispute.status === "won" ? "success" : dispute.status === "lost" ? "critical" : "warning"}>
                    {(dispute.status ?? "unknown").replace(/_/g, " ")}
                  </Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Reason</Text>
                  <Text as="p" variant="bodyMd">{dispute.reason ?? "Unknown"}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Amount</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {formatCurrency(dispute.amount, dispute.currency_code)}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Initiated</Text>
                  <Text as="p" variant="bodyMd">{formatDate(dispute.initiated_at)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Due Date</Text>
                  <Text as="p" variant="bodyMd">{formatDate(dispute.due_at)}</Text>
                </BlockStack>
              </InlineStack>

              <Banner tone={dispute.due_at && new Date(dispute.due_at) < new Date() ? "critical" : "warning"}>
                {daysUntil(dispute.due_at)}
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Order card */}
        {orderNum && (
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Linked Order</Text>
                <Text as="p" variant="bodyMd">Order #{orderNum}</Text>
                {shopDomain && (
                  <Button
                    variant="plain"
                    url={`https://${shopDomain}/admin/orders/${orderNum}`}
                    target="_blank"
                  >
                    Open in Shopify Admin
                  </Button>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Sync info */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Sync Info</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Last synced: {formatDate(dispute.last_synced_at)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Evidence GID: {dispute.dispute_evidence_gid ?? "Not available"}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Evidence Packs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Evidence Packs</Text>
                <Button onClick={handleGenerate} loading={generating}>
                  Generate New Pack
                </Button>
              </InlineStack>

              {packs.length === 0 ? (
                <>
                  <Divider />
                  <Text as="p" tone="subdued">
                    No evidence packs yet. Generate one to get started.
                  </Text>
                </>
              ) : (
                <>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text", "text"]}
                    headings={["Pack ID", "Status", "Score", "Blockers", "Created"]}
                    rows={packs.map((p) => [
                      p.id.slice(0, 8),
                      p.status.replace(/_/g, " "),
                      p.completeness_score != null ? `${p.completeness_score}%` : "—",
                      p.blockers && p.blockers.length > 0
                        ? `${p.blockers.length} blocker(s)`
                        : "None",
                      formatDate(p.created_at),
                    ])}
                  />
                  <div style={{ marginTop: "8px" }}>
                    {packs.map((p) => (
                      <Button key={p.id} variant="plain" url={`/app/packs/${p.id}`}>
                        View pack {p.id.slice(0, 8)} →
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Compliance note */}
        <Layout.Section>
          <Banner tone="info">
            Evidence is saved to Shopify via API. Submission to the card
            network happens in Shopify Admin, or Shopify auto-submits on the
            due date.
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

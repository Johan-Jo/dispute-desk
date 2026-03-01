"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
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
  const t = useTranslations();
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const daysUntil = (iso: string | null): string => {
    if (!iso) return "—";
    const diff = Math.ceil(
      (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (diff < 0) return t("disputes.daysOverdue", { count: Math.abs(diff) });
    if (diff === 0) return t("disputes.dueToday");
    return t("disputes.daysRemaining", { count: diff });
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/disputes/${id}`);
    const json = await res.json();
    setDispute(json.dispute ?? null);
    setPacks(json.packs ?? []);
    setShopDomain(json.shop_domain ?? null);
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
    setQuotaError(null);
    const res = await fetch(`/api/disputes/${id}/packs`, { method: "POST" });
    if (res.status === 403) {
      const data = await res.json();
      setQuotaError(data.error ?? t("disputes.planLimitMessage"));
    } else {
      await fetchData();
    }
    setGenerating(false);
  };

  if (loading) {
    return (
      <Page title={t("disputes.title")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!dispute) {
    return (
      <Page title={t("disputes.title")} backAction={{ content: t("disputes.title"), url: "/app/disputes" }}>
        <Banner tone="critical">{t("disputes.disputeNotFound")}</Banner>
      </Page>
    );
  }

  const orderNum = dispute.order_gid?.split("/").pop();
  const shopDomainForOrder =
    typeof window !== "undefined"
      ? document.cookie.match(/shopify_shop=([^;]+)/)?.[1]
      : null;
  const disputeUrl =
    shopDomain && dispute.dispute_gid
      ? getShopifyDisputeUrl(shopDomain, dispute.dispute_gid)
      : null;

  return (
    <Page
      title={t("disputes.disputeTitle", { id: dispute.dispute_gid.split("/").pop() ?? "" })}
      backAction={{ content: t("disputes.title"), url: "/app/disputes" }}
      primaryAction={{
        content: generating ? t("disputes.generating") : t("disputes.generatePack"),
        onAction: handleGenerate,
        loading: generating,
      }}
      secondaryActions={[
        {
          content: syncing ? t("disputes.reSyncing") : t("disputes.reSync"),
          onAction: handleSync,
          loading: syncing,
        },
      ]}
    >
      <Layout>
        {quotaError && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={t("disputes.packLimitReached")}
              action={{ content: t("disputes.upgradePlan"), url: "/app/billing" }}
              onDismiss={() => setQuotaError(null)}
            >
              <p>{quotaError}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("disputes.summary")}</Text>
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("table.status")}</Text>
                  <Badge tone={dispute.status === "won" ? "success" : dispute.status === "lost" ? "critical" : "warning"}>
                    {(dispute.status ?? "unknown").replace(/_/g, " ")}
                  </Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("disputes.reason")}</Text>
                  <Text as="p" variant="bodyMd">{dispute.reason ?? t("status.unknown")}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("disputes.amount")}</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    {formatCurrency(dispute.amount, dispute.currency_code)}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("disputes.initiated")}</Text>
                  <Text as="p" variant="bodyMd">{formatDate(dispute.initiated_at)}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{t("disputes.dueDate")}</Text>
                  <Text as="p" variant="bodyMd">{formatDate(dispute.due_at)}</Text>
                </BlockStack>
              </InlineStack>

              <Banner tone={dispute.due_at && new Date(dispute.due_at) < new Date() ? "critical" : "warning"}>
                {daysUntil(dispute.due_at)}
              </Banner>
              {disputeUrl && (
                <Button url={disputeUrl} target="_blank">
                  {t("disputes.openDisputeInShopify")}
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {orderNum && (
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">{t("disputes.linkedOrder")}</Text>
                <Text as="p" variant="bodyMd">{t("disputes.order")} #{orderNum}</Text>
                {shopDomainForOrder && (
                  <Button
                    variant="plain"
                    url={`https://${shopDomainForOrder}/admin/orders/${orderNum}`}
                    target="_blank"
                  >
                    {t("disputes.openInShopify")}
                  </Button>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">{t("disputes.syncInfo")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("disputes.lastSynced")}: {formatDate(dispute.last_synced_at)}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("disputes.evidenceGid")}: {dispute.dispute_evidence_gid ?? t("common.notAvailable")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">{t("disputes.evidencePacks")}</Text>
                <Button onClick={handleGenerate} loading={generating}>
                  {t("disputes.generateNewPack")}
                </Button>
              </InlineStack>

              {packs.length === 0 ? (
                <>
                  <Divider />
                  <Text as="p" tone="subdued">
                    {t("disputes.noPacks")}
                  </Text>
                </>
              ) : (
                <>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text", "text"]}
                    headings={[
                      t("table.id"),
                      t("table.status"),
                      t("table.score"),
                      t("disputes.blockers"),
                      t("table.created"),
                    ]}
                    rows={packs.map((p) => [
                      p.id.slice(0, 8),
                      p.status.replace(/_/g, " "),
                      p.completeness_score != null ? `${p.completeness_score}%` : "—",
                      p.blockers && p.blockers.length > 0
                        ? `${p.blockers.length} blocker(s)`
                        : t("common.none"),
                      formatDate(p.created_at),
                    ])}
                  />
                  <div style={{ marginTop: "8px" }}>
                    {packs.map((p) => (
                      <Button key={p.id} variant="plain" url={`/app/packs/${p.id}`}>
                        {t("packs.viewPack", { id: p.id.slice(0, 8) })}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Banner tone="info">
            {t("disputes.compliance")}
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

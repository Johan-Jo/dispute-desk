/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/packs/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-packs.tsx
 * Reference: evidence packs list layout.
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
  Button,
  Spinner,
  InlineStack,
  BlockStack,
  Modal,
  EmptyState,
  Filters,
  ChoiceList,
} from "@shopify/polaris";

interface PackRow {
  id: string;
  name: string;
  code: string | null;
  dispute_type: string;
  status: string;
  source: string;
  template_id: string | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
}

interface TemplateItem {
  id: string;
  name: string;
  short_description?: string;
  dispute_type: string;
  is_recommended?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  FRAUD: "typeFraudulent",
  PNR: "typeProductNotReceived",
  NOT_AS_DESCRIBED: "typeProductUnacceptable",
  SUBSCRIPTION: "typeSubscriptionCanceled",
  REFUND: "typeCreditNotProcessed",
  DUPLICATE: "typeDuplicate",
  DIGITAL: "typeDigital",
  GENERAL: "typeGeneral",
};

function statusTone(status: string): "success" | "warning" | "critical" | "info" | undefined {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return undefined;
}

function formatDate(iso: string | null, t: (key: string) => string): string {
  if (!iso) return t("packTemplates.never");
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PacksListPage() {
  const router = useRouter();
  const t = useTranslations();
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [queryValue, setQueryValue] = useState("");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const shopId =
    typeof window !== "undefined"
      ? document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? ""
      : "";

  const fetchPacks = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const params = new URLSearchParams({ shopId });
    if (statusFilter.length === 1 && statusFilter[0] !== "all") {
      params.set("status", statusFilter[0].toUpperCase());
    }
    if (queryValue.trim()) params.set("q", queryValue.trim());

    try {
      const res = await fetch(`/api/packs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [shopId, statusFilter, queryValue]);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch("/api/templates?locale=en-US");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (templateModalOpen) fetchTemplates();
  }, [templateModalOpen, fetchTemplates]);

  const handleInstallTemplate = useCallback(
    async (templateId: string) => {
      if (!shopId) return;
      setInstallingId(templateId);
      try {
        const res = await fetch(`/api/templates/${templateId}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shopId }),
        });
        if (res.ok) {
          const pack = await res.json();
          setTemplateModalOpen(false);
          router.push(`/app/packs/${pack.id}`);
        }
      } finally {
        setInstallingId(null);
      }
    },
    [shopId, router]
  );

  const displayPacks =
    queryValue.trim() === ""
      ? packs
      : packs.filter((p) => {
          const q = queryValue.toLowerCase().trim();
          return (
            p.name.toLowerCase().includes(q) ||
            p.dispute_type.toLowerCase().includes(q)
          );
        });

  const filters = [
    {
      key: "status",
      label: t("table.status"),
      filter: (
        <ChoiceList
          title={t("table.status")}
          titleHidden
          choices={[
            { label: t("packTemplates.filterAll"), value: "all" },
            { label: t("packTemplates.filterActive"), value: "active" },
            { label: t("packTemplates.filterDraft"), value: "draft" },
            { label: t("packTemplates.filterArchived"), value: "archived" },
          ]}
          selected={statusFilter}
          onChange={setStatusFilter}
          allowMultiple={false}
        />
      ),
      shortcut: true,
    },
  ];

  const resourceName = { singular: "evidence pack", plural: "evidence packs" };

  const rowMarkup = displayPacks.map((pack, idx) => (
    <IndexTable.Row
      id={pack.id}
      key={pack.id}
      position={idx}
      onClick={() => router.push(`/app/packs/${pack.id}`)}
    >
      <IndexTable.Cell>
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {pack.name}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {pack.code ?? pack.id.slice(0, 8)}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {TYPE_LABELS[pack.dispute_type]
          ? t(`packTemplates.${TYPE_LABELS[pack.dispute_type]}`)
          : pack.dispute_type}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={pack.source === "TEMPLATE" ? "info" : undefined}>
          {pack.source === "TEMPLATE"
            ? t("packTemplates.sourceTemplate")
            : t("packTemplates.sourceManual")}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{pack.usage_count}</IndexTable.Cell>
      <IndexTable.Cell>{formatDate(pack.last_used_at, t)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusTone(pack.status)}>
          {pack.status === "ACTIVE"
            ? t("packTemplates.filterActive")
            : pack.status === "DRAFT"
              ? t("packTemplates.filterDraft")
              : t("packTemplates.filterArchived")}
        </Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const emptyState =
    !loading && displayPacks.length === 0 ? (
      <EmptyState
        heading={packs.length === 0 ? t("packTemplates.setupTitle") : t("packTemplates.emptyTitle")}
        action={{
          content: t("packTemplates.startFromTemplate"),
          onAction: () => setTemplateModalOpen(true),
        }}
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>
          {packs.length === 0
            ? t("packTemplates.setupDescription")
            : t("packTemplates.emptyDescription")}
        </p>
      </EmptyState>
    ) : null;

  return (
    <>
      <Page
        title={t("packTemplates.title")}
        subtitle={t("packTemplates.subtitle")}
        primaryAction={{
          content: t("packTemplates.startFromTemplate"),
          onAction: () => setTemplateModalOpen(true),
        }}
      >
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Filters
                queryValue={queryValue}
                filters={filters}
                onQueryChange={setQueryValue}
                onQueryClear={() => setQueryValue("")}
                onClearAll={() => {
                  setStatusFilter([]);
                  setQueryValue("");
                }}
                queryPlaceholder={t("packTemplates.searchPlaceholder")}
              />
              {loading ? (
                <div style={{ padding: "2rem", textAlign: "center" }}>
                  <Spinner size="large" />
                </div>
              ) : emptyState ? (
                <div style={{ padding: "2rem" }}>{emptyState}</div>
              ) : (
                <IndexTable
                  resourceName={resourceName}
                  itemCount={displayPacks.length}
                  headings={[
                    { title: t("packTemplates.packName") },
                    { title: t("packTemplates.type") },
                    { title: t("packTemplates.source") },
                    { title: t("packTemplates.usageCount") },
                    { title: t("packTemplates.lastUsed") },
                    { title: t("table.status") },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </Page>

      <Modal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title={t("templateLibrary.title")}
      >
        <Modal.Section>
          {templatesLoading ? (
            <div style={{ padding: "2rem", textAlign: "center" }}>
              <Spinner size="large" />
            </div>
          ) : (
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("templateLibrary.subtitle")}
              </Text>
              {templates.length === 0 ? (
                <Text as="p" variant="bodyMd">
                  {t("packTemplates.emptyTitle")}
                </Text>
              ) : (
                <BlockStack gap="300">
                  {templates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "12px 0",
                        borderBottom: "1px solid var(--p-color-border)",
                      }}
                    >
                      <BlockStack gap="100">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {tmpl.name}
                        </Text>
                        {tmpl.short_description && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {tmpl.short_description}
                          </Text>
                        )}
                        <Text as="span" variant="bodySm" tone="subdued">
                          {tmpl.dispute_type.replace(/_/g, " ")}
                        </Text>
                      </BlockStack>
                      <Button
                        variant="primary"
                        size="slim"
                        loading={installingId === tmpl.id}
                        onClick={() => handleInstallTemplate(tmpl.id)}
                      >
                        {installingId === tmpl.id
                          ? t("templateLibrary.installing")
                          : t("packTemplates.installTemplate")}
                      </Button>
                    </div>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>
    </>
  );
}

/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/packs/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-packs.tsx
 * Reference: header "Create and manage reusable evidence templates", search bar,
 * "Create Pack" primary action, card grid (icon, name, id, disputes count, completeness %, last used,
 * Active/Draft badge, "View pack" with chevron).
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
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
  documents_count?: number;
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

function statusTone(status: string): "success" | "warning" | undefined {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "warning";
  return undefined;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

  useEffect(() => { fetchPacks(); }, [fetchPacks]);

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
          return p.name.toLowerCase().includes(q) || p.dispute_type.toLowerCase().includes(q);
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
          {/* Search & filter bar */}
          <Layout.Section>
            <Card padding="0">
              <Filters
                queryValue={queryValue}
                filters={filters}
                onQueryChange={setQueryValue}
                onQueryClear={() => setQueryValue("")}
                onClearAll={() => { setStatusFilter([]); setQueryValue(""); }}
                queryPlaceholder={t("packTemplates.searchPlaceholder")}
              />
            </Card>
          </Layout.Section>

          {/* Packs grid — one card per pack (Figma card layout) */}
          <Layout.Section>
            {loading ? (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            ) : displayPacks.length === 0 ? (
              <EmptyState
                heading={packs.length === 0 ? t("packTemplates.setupTitle") : t("packTemplates.emptyTitle")}
                action={{ content: t("packTemplates.startFromTemplate"), onAction: () => setTemplateModalOpen(true) }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>{packs.length === 0 ? t("packTemplates.setupDescription") : t("packTemplates.emptyDescription")}</p>
              </EmptyState>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: "16px",
                }}
              >
                {displayPacks.map((pack) => (
                  <button
                    key={pack.id}
                    onClick={() => router.push(`/app/packs/${pack.id}`)}
                    style={{
                      all: "unset",
                      display: "block",
                      cursor: "pointer",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    <Card>
                      <BlockStack gap="300">
                        {/* Card header: icon + name + status badge */}
                        <InlineStack align="space-between" blockAlign="start" wrap={false}>
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <div
                              style={{
                                width: 40,
                                height: 40,
                                background: "var(--p-color-bg-fill-info-secondary)",
                                borderRadius: 8,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 18,
                                flexShrink: 0,
                              }}
                            >
                              📄
                            </div>
                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {pack.name}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {pack.code ?? pack.id.slice(0, 8)}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          <Badge tone={statusTone(pack.status)}>
                            {pack.status === "ACTIVE"
                              ? t("packTemplates.filterActive")
                              : pack.status === "DRAFT"
                                ? t("packTemplates.filterDraft")
                                : t("packTemplates.filterArchived")}
                          </Badge>
                        </InlineStack>

                        {/* Stats row: usage, documents, last used, type */}
                        <InlineStack gap="400" wrap>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">{t("packTemplates.usageCount")}</Text>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">{pack.usage_count}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">{t("packTemplates.documents")}</Text>
                            <Text as="span" variant="bodySm">{pack.documents_count ?? 0}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">{t("packTemplates.lastUsed")}</Text>
                            <Text as="span" variant="bodySm">{formatDate(pack.last_used_at)}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">{t("packTemplates.type")}</Text>
                            <Text as="span" variant="bodySm">
                              {TYPE_LABELS[pack.dispute_type]
                                ? t(`packTemplates.${TYPE_LABELS[pack.dispute_type]}`)
                                : pack.dispute_type}
                            </Text>
                          </BlockStack>
                        </InlineStack>

                        {/* Footer */}
                        <div style={{ borderTop: "1px solid var(--p-color-border)", paddingTop: 12, marginTop: 4 }}>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodyMd" tone="magic">
                              {t("common.viewAll")}
                            </Text>
                            <span style={{ color: "var(--p-color-bg-fill-info)" }}>›</span>
                          </InlineStack>
                        </div>
                      </BlockStack>
                    </Card>
                  </button>
                ))}
              </div>
            )}
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
                <Text as="p" variant="bodyMd">{t("packTemplates.emptyTitle")}</Text>
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
                        <Text as="span" variant="bodyMd" fontWeight="semibold">{tmpl.name}</Text>
                        {tmpl.short_description && (
                          <Text as="span" variant="bodySm" tone="subdued">{tmpl.short_description}</Text>
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

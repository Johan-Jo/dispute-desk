/**
 * Embedded packs page aligned to portal/web layout:
 * - Header with "Start from template" + "Create Pack"
 * - Dismissible template info banner
 * - Search + status tabs + table view
 * - Row actions (activate/edit/delete)
 */
"use client";

import "./packs.css";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Page,
  Card,
  Text,
  Badge,
  Button,
  Spinner,
  InlineStack,
  BlockStack,
  Modal,
  EmptyState,
  Banner,
  Tabs,
  TextField,
  Select,
  IndexTable,
} from "@shopify/polaris";
import { FileText } from "lucide-react";
import { SearchIcon, EditIcon, DeleteIcon } from "@shopify/polaris-icons";

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

const DISPUTE_TYPES = [
  "FRAUD",
  "PNR",
  "NOT_AS_DESCRIBED",
  "SUBSCRIPTION",
  "REFUND",
  "DUPLICATE",
  "DIGITAL",
  "GENERAL",
] as const;

function formatDate(iso: string | null, locale: string, fallback: string): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusTone(status: string): "success" | "attention" | undefined {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "attention";
  return undefined;
}

type StatusTab = "all" | "active" | "draft" | "archived";

export default function PacksListPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations();

  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryValue, setQueryValue] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("all");

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<string>(DISPUTE_TYPES[0]);

  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [showTemplateBanner, setShowTemplateBanner] = useState(true);
  const [recommendedTemplates, setRecommendedTemplates] = useState<TemplateItem[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  const [recommendedFetched, setRecommendedFetched] = useState(false);

  const fetchPacks = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusTab !== "all") params.set("status", statusTab.toUpperCase());
    if (queryValue.trim()) params.set("q", queryValue.trim());

    try {
      const qs = params.toString();
      const url = qs ? `/api/packs?${qs}` : "/api/packs";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs ?? []);
      } else {
        setPacks([]);
      }
    } finally {
      setLoading(false);
    }
  }, [statusTab, queryValue]);

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
      } else {
        setTemplates([]);
      }
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const fetchRecommendedTemplates = useCallback(async () => {
    setRecommendedLoading(true);
    try {
      const res = await fetch(`/api/templates?locale=${encodeURIComponent(locale)}`);
      if (res.ok) {
        const data = await res.json();
        const list = (data.templates ?? []) as TemplateItem[];
        setRecommendedTemplates(list.filter((tpl) => Boolean(tpl.is_recommended)).slice(0, 4));
      } else {
        setRecommendedTemplates([]);
      }
    } finally {
      setRecommendedLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (templateModalOpen) fetchTemplates();
  }, [templateModalOpen, fetchTemplates]);

  useEffect(() => {
    if (loading) return;
    if (packs.length !== 0) return;
    if (queryValue.trim() !== "") return;
    if (recommendedFetched) return;
    setRecommendedFetched(true);
    fetchRecommendedTemplates().catch(() => {
      setRecommendedTemplates([]);
      setRecommendedLoading(false);
    });
  }, [fetchRecommendedTemplates, loading, packs.length, queryValue, recommendedFetched]);

  useEffect(() => {
    // Empty-state recommendations depend on the current filter/search.
    setRecommendedFetched(false);
  }, [statusTab, queryValue]);

  const handleInstallTemplate = useCallback(
    async (templateId: string) => {
      setInstallingId(templateId);
      try {
        const res = await fetch(`/api/templates/${templateId}/install`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
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
    [router]
  );

  const handleActivate = useCallback(
    async (packId: string) => {
      setActivatingId(packId);
      try {
        const res = await fetch(`/api/packs/${packId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ACTIVE" }),
        });
        if (res.ok) await fetchPacks();
      } finally {
        setActivatingId(null);
      }
    },
    [fetchPacks]
  );

  const handleDelete = useCallback(
    async (packId: string) => {
      if (!confirm(t("packTemplates.confirmDelete"))) return;
      const res = await fetch(`/api/packs/${packId}`, { method: "DELETE" });
      if (res.ok) await fetchPacks();
    },
    [fetchPacks, t]
  );

  const handleCreatePack = useCallback(async () => {
    if (!formName.trim() || !formType) return;
    setCreating(true);
    try {
      const res = await fetch("/api/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          disputeType: formType,
        }),
      });
      if (res.ok) {
        setCreateModalOpen(false);
        setFormName("");
        setFormType(DISPUTE_TYPES[0]);
        await fetchPacks();
      }
    } finally {
      setCreating(false);
    }
  }, [formName, formType, fetchPacks]);

  const tabs = [
    { id: "all", content: t("packTemplates.filterAll"), panelID: "packs-all" },
    { id: "active", content: t("packTemplates.filterActive"), panelID: "packs-active" },
    { id: "draft", content: t("packTemplates.filterDraft"), panelID: "packs-draft" },
    { id: "archived", content: t("packTemplates.filterArchived"), panelID: "packs-archived" },
  ];
  const selectedTab = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === statusTab)
  );

  const displayPacks =
    queryValue.trim() === ""
      ? packs
      : packs.filter((pack) => {
          const q = queryValue.toLowerCase().trim();
          return (
            pack.name.toLowerCase().includes(q) ||
            pack.dispute_type.toLowerCase().includes(q)
          );
        });

  const showEmpty = !loading && displayPacks.length === 0;

  return (
    <>
      <Page
        title={t("packTemplates.title")}
        subtitle={t("packTemplates.subtitle")}
        primaryAction={{
          content: t("packTemplates.startFromTemplate"),
          onAction: () => setTemplateModalOpen(true),
        }}
        secondaryActions={[
          {
            content: t("packTemplates.createPack"),
            onAction: () => setCreateModalOpen(true),
          },
        ]}
        fullWidth
      >
        <div className="embeddedPacksRoot">
        <BlockStack gap="400">
          {!loading && packs.length > 0 && showTemplateBanner && (
            <Banner
              title={t("packTemplates.exploreMoreTemplates")}
              tone="info"
              onDismiss={() => setShowTemplateBanner(false)}
            >
              <p>
                <button
                  type="button"
                  onClick={() => setTemplateModalOpen(true)}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "var(--p-color-text-link)",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                    fontWeight: 600,
                  }}
                >
                  {t("packTemplates.browseTemplates")}
                </button>
              </p>
            </Banner>
          )}

          <Card padding="0">
            <BlockStack gap="0">
              <div className="embeddedPacksCardHeader">
                <div className="embeddedPacksSearchRow">
                <InlineStack align="space-between" wrap>
                  <div className="embeddedPacksSearchField" style={{ minWidth: 260 }}>
                    <TextField
                      label=""
                      labelHidden
                      autoComplete="off"
                      placeholder={t("packTemplates.searchPlaceholder")}
                      value={queryValue}
                      onChange={setQueryValue}
                      prefix={<span aria-hidden><svg viewBox="0 0 20 20" width="16" height="16"><path fill="currentColor" d="M8.5 2a6.5 6.5 0 0 1 5.147 10.472l3.94 3.94a.75.75 0 1 1-1.06 1.06l-3.94-3.94A6.5 6.5 0 1 1 8.5 2m0 1.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10"/></svg></span>}
                    />
                  </div>
                  <div className="embeddedPacksSearchFilterButton">
                    <Button
                      icon={SearchIcon}
                      variant="tertiary"
                      accessibilityLabel={t("packTemplates.searchPlaceholder")}
                    />
                  </div>
                </InlineStack>
                </div>
              </div>

              <Tabs
                tabs={tabs}
                selected={selectedTab}
                onSelect={(index) => setStatusTab(tabs[index].id as StatusTab)}
              />

              {loading ? (
                <div style={{ padding: "3rem", textAlign: "center" }}>
                  <Spinner size="large" />
                </div>
              ) : showEmpty ? (
                <div style={{ padding: "1rem" }}>
                  <EmptyState
                    heading={packs.length === 0 ? t("packTemplates.setupTitle") : t("packTemplates.emptyTitle")}
                    action={
                      {
                        content: t("packTemplates.startFromTemplate"),
                        onAction: () => setTemplateModalOpen(true),
                      }
                    }
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      {packs.length === 0 ? t("packTemplates.setupDescription") : t("packTemplates.emptyDescription")}
                    </p>
                  </EmptyState>

                  {packs.length === 0 && queryValue.trim() === "" && (
                    <div style={{ marginTop: 18 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--p-text-subdued)" }}>
                        {t("packTemplates.recommendedTemplates")}
                      </div>

                      {recommendedLoading ? (
                        <div style={{ padding: "1rem 0", display: "flex", justifyContent: "center" }}>
                          <Spinner size="small" />
                        </div>
                      ) : recommendedTemplates.length === 0 ? null : (
                        <div className="embeddedPacksEmptyRecommendationsGrid">
                          {recommendedTemplates.map((tmpl) => (
                            <div
                              key={tmpl.id}
                              style={{
                                border: "1px solid var(--p-color-border)",
                                borderRadius: 8,
                                padding: 12,
                                background: "var(--p-color-bg)",
                              }}
                            >
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {tmpl.name}
                              </Text>
                              <div style={{ marginTop: 8 }}>
                                <Badge>
                                  {TYPE_LABELS[tmpl.dispute_type]
                                    ? t(`packTemplates.${TYPE_LABELS[tmpl.dispute_type]}`)
                                    : tmpl.dispute_type}
                                </Badge>
                              </div>
                              {tmpl.short_description ? (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {tmpl.short_description}
                                </Text>
                              ) : null}
                              <div style={{ marginTop: 12 }}>
                                <Button
                                  variant="primary"
                                  size="slim"
                                  fullWidth
                                  disabled={installingId !== null}
                                  loading={installingId === tmpl.id}
                                  onClick={() => handleInstallTemplate(tmpl.id)}
                                >
                                  {t("packTemplates.installTemplate")}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <IndexTable
                  resourceName={{ singular: "pack", plural: "packs" }}
                  itemCount={displayPacks.length}
                  headings={[
                    { title: t("packTemplates.packName") },
                    { title: t("packTemplates.type") },
                    { title: t("packTemplates.source") },
                    { title: t("packTemplates.usageCount") },
                    { title: t("packTemplates.lastUsed") },
                    { title: t("table.status") },
                    { title: t("table.actions") },
                  ]}
                  selectable={false}
                >
                  {displayPacks.map((pack, idx) => {
                    const typeLabelKey = TYPE_LABELS[pack.dispute_type];
                    return (
                      <IndexTable.Row
                        key={pack.id}
                        id={pack.id}
                        position={idx}
                      >
                        <IndexTable.Cell>
                          <button
                            type="button"
                            onClick={() => router.push(`/app/packs/${pack.id}`)}
                            style={{
                              border: 0,
                              background: "transparent",
                              padding: 0,
                              margin: 0,
                              width: "100%",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            <InlineStack gap="200" blockAlign="center">
                              <div className="embeddedPacksNameCellIcon">
                                <FileText size={16} style={{ color: "#4F46E5" }} />
                              </div>
                              <BlockStack gap="025">
                                <div className="embeddedPacksNameTextPrimary">
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    {pack.name}
                                  </Text>
                                </div>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {pack.code ?? pack.id.slice(0, 8)}
                                </Text>
                              </BlockStack>
                            </InlineStack>
                          </button>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="p" variant="bodySm">
                            {typeLabelKey ? t(`packTemplates.${typeLabelKey}`) : pack.dispute_type}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={pack.source === "TEMPLATE" ? "info" : undefined}>
                            {pack.source === "TEMPLATE"
                              ? t("packTemplates.sourceTemplate")
                              : t("packTemplates.sourceManual")}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="p" variant="bodySm">
                            {pack.usage_count}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {formatDate(pack.last_used_at, locale, t("packTemplates.never"))}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {pack.status === "DRAFT" ? (
                            <InlineStack gap="200" blockAlign="center" wrap={false}>
                              <Badge tone="attention">
                                {t("packTemplates.filterDraft")}
                              </Badge>
                              <Button
                                variant="plain"
                                size="slim"
                                loading={activatingId === pack.id}
                                disabled={activatingId !== null}
                                onClick={() => handleActivate(pack.id)}
                              >
                                {t("packTemplates.activate")}
                              </Button>
                            </InlineStack>
                          ) : (
                            <Badge tone={statusTone(pack.status)}>
                              {pack.status === "ACTIVE"
                                ? t("packTemplates.badgeActivated")
                                : pack.status === "ARCHIVED"
                                  ? t("packTemplates.filterArchived")
                                  : t("packTemplates.filterDraft")}
                            </Badge>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <InlineStack gap="050" align="end">
                            <Button
                              icon={EditIcon}
                              variant="tertiary"
                              size="micro"
                              accessibilityLabel={t("packTemplates.editPack")}
                              onClick={() => router.push(`/app/packs/${pack.id}`)}
                            />
                            <Button
                              icon={DeleteIcon}
                              variant="tertiary"
                              size="micro"
                              accessibilityLabel={t("packTemplates.deletePack")}
                              onClick={() => handleDelete(pack.id)}
                            />
                          </InlineStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </BlockStack>
        </div>
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
          ) : templates.length === 0 ? (
            <Text as="p" variant="bodyMd" tone="subdued">
              {t("packTemplates.emptyDescription")}
            </Text>
          ) : (
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" tone="subdued">
                {t("templateLibrary.subtitle")}
              </Text>
              {templates.map((template) => (
                <InlineStack key={template.id} align="space-between" blockAlign="center" wrap={false}>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {template.name}
                    </Text>
                    {template.short_description ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {template.short_description}
                      </Text>
                    ) : null}
                  </BlockStack>
                  <Button
                    size="slim"
                    variant="primary"
                    loading={installingId === template.id}
                    onClick={() => handleInstallTemplate(template.id)}
                  >
                    {t("packTemplates.installTemplate")}
                  </Button>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </Modal.Section>
      </Modal>

      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={t("packTemplates.modalTitle")}
        primaryAction={{
          content: t("packTemplates.create"),
          onAction: handleCreatePack,
          loading: creating,
          disabled: !formName.trim(),
        }}
        secondaryActions={[
          {
            content: t("packTemplates.cancel"),
            onAction: () => setCreateModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label={t("packTemplates.nameLabel")}
              autoComplete="off"
              value={formName}
              onChange={setFormName}
              placeholder={t("packTemplates.namePlaceholder")}
            />
            <Select
              label={t("packTemplates.typeLabel")}
              options={DISPUTE_TYPES.map((type) => ({
                label: TYPE_LABELS[type] ? t(`packTemplates.${TYPE_LABELS[type]}`) : type,
                value: type,
              }))}
              value={formType}
              onChange={setFormType}
            />
            <Text as="p" variant="bodySm" tone="subdued">
              {t("packTemplates.nextSteps")}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

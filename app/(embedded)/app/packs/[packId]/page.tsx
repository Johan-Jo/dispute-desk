/**
 * Embedded pack detail page.
 *
 * Four sections: status hero (readiness + metadata), work card (evidence
 * needed + upload + collected), collapsed activity log, and a dynamic
 * Page primary action that picks the single most useful next step based
 * on the pack's state.
 */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
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
  ProgressBar,
  Collapsible,
  Icon,
  DropZone,
  Modal,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@shopify/polaris-icons";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import { formatPackStatus } from "@/lib/types/packStatus";

interface ChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

interface EvidenceItem {
  id: string;
  type: string;
  label: string;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface AuditEvent {
  id: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  actor_type: string;
  created_at: string;
}

interface TemplateItemRow {
  section_title: string;
  key: string;
  label: string;
  required: boolean;
  guidance: string | null;
  item_type: string;
}

interface PackData {
  id: string;
  shop_id: string;
  name?: string;
  dispute_id: string | null;
  dispute_type?: string | null;
  shop_domain?: string | null;
  dispute_gid?: string | null;
  dispute_phase?: string | null;
  status: string;
  completeness_score: number | null;
  checklist: ChecklistItem[] | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  pack_json: Record<string, unknown> | null;
  pdf_path: string | null;
  saved_to_shopify_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  evidence_items: EvidenceItem[];
  audit_events: AuditEvent[];
  active_build_job: { id: string; status: string } | null;
  active_pdf_job: { id: string; status: string } | null;
  source?: string | null;
  template_id?: string | null;
  template_name?: string | null;
  template_items?: TemplateItemRow[];
}

function statusTone(status: string): "success" | "warning" | "critical" | "info" | undefined {
  switch (status) {
    case "saved_to_shopify": return "success";
    case "ready": return "warning";
    case "blocked": case "failed": return "critical";
    case "building": case "queued": return "info";
    default: return undefined;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Best-effort mapping from template item key → where that evidence comes
// from when the template runs on a real dispute. The collectors in
// lib/packs/sources/ emit specific field names, but templates may use
// their own naming, so we pattern-match by keyword. This is a merchant-
// facing hint, not a contract — merchants shouldn't infer that every
// `*_tracking` item is actually auto-collected.
type FieldSource =
  | "shopify_order"
  | "shopify_shipping"
  | "store_policy"
  | "merchant_upload";

function getFieldSource(key: string): FieldSource {
  const k = key.toLowerCase();
  if (k.includes("policy") || k.includes("terms")) return "store_policy";
  if (
    k.includes("tracking") ||
    k.includes("carrier") ||
    k.includes("delivery") ||
    k.startsWith("shipping_") ||
    k.includes("shipping_receipt") ||
    k.includes("shipping_method")
  )
    return "shopify_shipping";
  if (
    k.includes("customer_email") ||
    k.includes("customer_comm") ||
    k.includes("correspondence") ||
    k.includes("message") ||
    k === "customer_account_info" ||
    k.startsWith("note") ||
    k.includes("_note")
  )
    return "merchant_upload";
  return "shopify_order";
}

function getFieldSourceLabel(source: FieldSource, t: (key: string) => string): string {
  switch (source) {
    case "shopify_order":
      return t("packs.sourceShopifyOrder");
    case "shopify_shipping":
      return t("packs.sourceShopifyShipping");
    case "store_policy":
      return t("packs.sourceStorePolicy");
    case "merchant_upload":
      return t("packs.sourceMerchantUpload");
  }
}

const EVENT_TYPE_KEYS: Record<string, string> = {
  pack_created: "packs.eventPackCreated",
  evidence_collected: "packs.eventEvidenceCollected",
  pdf_rendered: "packs.eventPdfRendered",
  pack_saved: "packs.eventPackSaved",
  save_failed: "packs.eventSaveFailed",
  build_started: "packs.eventBuildStarted",
  build_completed: "packs.eventBuildCompleted",
  manual_upload: "packs.eventManualUpload",
};

function getReadinessStateLabel(score: number, t: (key: string) => string): string {
  if (score >= 90) return t("packs.readinessReadyToReview");
  if (score >= 60) return t("packs.readinessNearlyReady");
  if (score >= 25) return t("packs.readinessInProgress");
  return t("packs.readinessJustStarted");
}

type PackStateKey = "blocked" | "ready" | "saved" | "inProgress" | "library";

function getPackStateKey(pack: PackData, isLibraryPack: boolean): PackStateKey {
  if (isLibraryPack) return "library";
  if (pack.status === "saved_to_shopify") return "saved";
  const hasBlockers = (pack.blockers?.length ?? 0) > 0;
  if (pack.status === "blocked" || hasBlockers) return "blocked";
  const score = pack.completeness_score ?? 0;
  if (score >= 80) return "ready";
  return "inProgress";
}

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <InlineStack gap="400" align="start" wrap blockAlign="start">
      <div style={{ minWidth: 140 }}>
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </InlineStack>
  );
}

export default function PackPreviewPage() {
  const { packId } = useParams<{ packId: string }>();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const locale = useLocale();
  const [pack, setPack] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSaveWarning, setShowSaveWarning] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const workCardRef = useRef<HTMLDivElement | null>(null);

  const fetchPack = useCallback(async () => {
    const res = await fetch(
      `/api/packs/${packId}?locale=${encodeURIComponent(locale)}`,
    );
    if (res.ok) {
      const data = await res.json();
      setPack(data);
      const isActive =
        data.status === "queued" ||
        data.status === "building" ||
        data.active_pdf_job;
      if (!isActive && pollRef.current) clearInterval(pollRef.current);
    }
    setLoading(false);
  }, [packId, locale]);

  useEffect(() => {
    fetchPack();
    pollRef.current = setInterval(fetchPack, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchPack]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const disputeUrl =
    pack?.shop_domain && pack?.dispute_gid && pack.dispute_id
      ? getShopifyDisputeUrl(pack.shop_domain, pack.dispute_gid)
      : null;

  const copyEvidence = async (item: EvidenceItem) => {
    const text =
      typeof item.payload === "string"
        ? item.payload
        : `${item.label}\n\n${JSON.stringify(item.payload, null, 2)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  const handleUpload = async (_files: File[], accepted: File[]) => {
    if (accepted.length === 0) return;
    setUploading(true);
    for (const file of accepted) {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name);
      await fetch(`/api/packs/${packId}/upload`, { method: "POST", body: form });
    }
    await fetchPack();
    setUploading(false);
  };

  const handleExportPdf = async () => {
    setRendering(true);
    await fetch(`/api/packs/${packId}/render-pdf`, { method: "POST" });
    pollRef.current = setInterval(fetchPack, 3000);
    await fetchPack();
    setRendering(false);
  };

  const handleDownload = async () => {
    const res = await fetch(`/api/packs/${packId}/download`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, "_blank");
    }
  };

  const handleSave = useCallback(
    async (confirmed = false) => {
      if (!pack) return;
      const currentScore = pack.completeness_score ?? 0;
      if (pack.status === "blocked" || currentScore === 0) {
        setSaveBlocked(true);
        return;
      }
      if (currentScore < 80 && !confirmed) {
        setShowSaveWarning(true);
        return;
      }
      setSaving(true);
      const body = currentScore < 80 ? { confirmLowCompleteness: true } : {};
      await fetch(`/api/packs/${packId}/save-to-shopify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowSaveWarning(false);
      await fetchPack();
      setSaving(false);
    },
    [pack, packId, fetchPack],
  );

  const scrollToWorkCard = () => {
    workCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <Page title={t("nav.playbooks")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!pack) {
    return (
      <Page title={t("nav.playbooks")} backAction={{ content: t("packs.backToPacks"), url: "/app/packs" }}>
        <Banner tone="critical">{t("packs.packNotFound")}</Banner>
      </Page>
    );
  }

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;
  const isLibraryPack = pack.dispute_id == null;
  const fromTemplate = pack.source === "TEMPLATE" && Boolean(pack.template_name ?? pack.name);
  const disputeTypeKey = pack.dispute_type ? pack.dispute_type.toUpperCase().replace(/\s+/g, "_") : "GENERAL";
  const disputeTypeRaw = t(`packs.disputeTypeLabel.${disputeTypeKey}` as Parameters<typeof t>[0]);
  // next-intl returns the full key path when a key is missing — detect that
  // and fall back to a human-readable form of the raw dispute_type.
  const disputeTypeLabel = pack.dispute_type
    ? (disputeTypeRaw.includes("disputeTypeLabel.") ? pack.dispute_type.replace(/_/g, " ") : disputeTypeRaw)
    : "—";
  const stateKey = getPackStateKey(pack, isLibraryPack);
  const phaseLabel =
    pack.dispute_phase === "inquiry"
      ? t("packs.phaseInquiry")
      : pack.dispute_phase === "chargeback"
        ? t("packs.phaseChargeback")
        : "—";

  const backUrl = withShopParams(
    isLibraryPack ? "/app/packs" : `/app/disputes/${pack.dispute_id}`,
    searchParams,
  );
  const backLabel = isLibraryPack ? t("packs.backToPacks") : t("disputes.backToDisputes");
  const pageTitle = isLibraryPack
    ? (pack.name ?? t("packs.playbookTitle"))
    : (pack.name ?? t("packs.evidencePackTitle"));

  const subtitle = isLibraryPack
    ? t("packs.subtitleLibrary", { type: disputeTypeLabel })
    : t("packs.subtitleDispute", { type: disputeTypeLabel, phase: phaseLabel });

  const stateSentence = (() => {
    if (stateKey === "saved")
      return t("packs.stateSavedHint", { date: formatDate(pack.saved_to_shopify_at) });
    if (stateKey === "blocked") return t("packs.stateBlockedHint");
    if (stateKey === "ready") return t("packs.stateReadyHint");
    if (stateKey === "library") return t("packs.stateLibraryHint");
    return t("packs.stateInProgressHint", { percent: score });
  })();

  const primaryAction = (() => {
    if (isLibraryPack) {
      return {
        content: t("packs.primaryBrowseTemplates"),
        url: withShopParams("/app/packs", searchParams),
      };
    }
    if (stateKey === "saved" && disputeUrl) {
      return {
        content: t("packs.openInShopifyAdmin"),
        url: disputeUrl,
        external: true,
      };
    }
    if (stateKey === "blocked" || score === 0) {
      return {
        content: t("packs.primaryResolveBlockers"),
        onAction: scrollToWorkCard,
      };
    }
    return {
      content: saving || pack.status === "saving" ? t("packs.saving") : t("packs.saveToShopify"),
      onAction: () => handleSave(),
      loading: saving || pack.status === "saving",
      disabled: isBuilding,
    };
  })();

  const secondaryActions: {
    content: string;
    onAction?: () => void | Promise<void>;
    loading?: boolean;
    disabled?: boolean;
  }[] = [];
  if (pack.active_pdf_job) {
    secondaryActions.push({
      content: t("packs.generatingPdf"),
      disabled: true,
    });
  } else if (pack.pdf_path) {
    secondaryActions.push({
      content: t("packs.downloadPdfReady"),
      onAction: handleDownload,
    });
  } else {
    secondaryActions.push({
      content: t("packs.exportPdf"),
      onAction: handleExportPdf,
      loading: rendering,
    });
  }

  const checklistItems = pack.checklist?.length
    ? pack.checklist.map((c) => ({ label: c.label, present: c.present }))
    : [];

  // Group template items by their parent section for the library-pack preview.
  const templateItemsBySection = (() => {
    const groups = new Map<string, TemplateItemRow[]>();
    for (const item of pack.template_items ?? []) {
      const key = item.section_title ?? "";
      const list = groups.get(key);
      if (list) list.push(item);
      else groups.set(key, [item]);
    }
    return Array.from(groups.entries()).map(([title, items]) => ({ title, items }));
  })();

  return (
    <Page
      title={pageTitle}
      subtitle={subtitle}
      backAction={{ content: backLabel, url: backUrl }}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      <Layout>
        {/* 1. Status hero */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start" wrap gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingLg">
                    {isLibraryPack
                      ? t("packs.packReadinessTemplate")
                      : `${score}% ${t("packs.readyLabel")}`}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {stateSentence}
                  </Text>
                </BlockStack>
                {!isLibraryPack && (
                  <Badge tone={statusTone(pack.status)}>
                    {getReadinessStateLabel(score, t)}
                  </Badge>
                )}
              </InlineStack>

              {!isLibraryPack && (
                <ProgressBar
                  progress={score}
                  tone={score >= 80 ? "success" : score >= 50 ? "highlight" : "critical"}
                  size="small"
                />
              )}

              {pack.blockers && pack.blockers.length > 0 && (
                <InlineStack gap="200" blockAlign="start" wrap={false}>
                  <div style={{ marginTop: 2 }}>
                    <Icon source={XCircleIcon} tone="critical" />
                  </div>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" fontWeight="semibold" tone="critical">
                      {t("packs.blockersInlineLabel")}
                    </Text>
                    <Text as="p" variant="bodySm">
                      {pack.blockers.join(", ")}
                    </Text>
                  </BlockStack>
                </InlineStack>
              )}

              {saveBlocked && (
                <Banner tone="critical" onDismiss={() => setSaveBlocked(false)}>
                  <Text as="p" fontWeight="semibold">{t("packs.saveBlockedTitle")}</Text>
                  <Text as="p">{t("packs.saveBlockedBody")}</Text>
                </Banner>
              )}
              {pack.status === "save_failed" && (
                <Banner tone="critical">{t("packs.saveFailed")}</Banner>
              )}
              {isBuilding && (
                <Banner tone="info">{t("packs.building")}</Banner>
              )}

              <Divider />

              {/* Metadata grid */}
              <BlockStack gap="200">
                <MetadataRow label={t("packs.metaType")}>
                  <Text as="span" variant="bodyMd">{disputeTypeLabel}</Text>
                </MetadataRow>
                {!isLibraryPack && pack.dispute_phase && (
                  <MetadataRow label={t("packs.metaPhase")}>
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Badge tone={pack.dispute_phase === "inquiry" ? "info" : "warning"}>
                        {phaseLabel}
                      </Badge>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {pack.dispute_phase === "inquiry"
                          ? t("packs.phaseInquiryHint")
                          : t("packs.phaseChargebackHint")}
                      </Text>
                    </InlineStack>
                  </MetadataRow>
                )}
                <MetadataRow label={t("packs.metaStatus")}>
                  <Badge tone={statusTone(pack.status)}>
                    {formatPackStatus(pack.status, t)}
                  </Badge>
                </MetadataRow>
                <MetadataRow label={t("packs.metaCreated")}>
                  <Text as="span" variant="bodyMd">{formatDate(pack.created_at)}</Text>
                </MetadataRow>
                {pack.saved_to_shopify_at && (
                  <MetadataRow label={t("packs.metaSavedAt")}>
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Icon source={CheckCircleIcon} tone="success" />
                      <Text as="span" variant="bodyMd">{formatDate(pack.saved_to_shopify_at)}</Text>
                      {disputeUrl && (
                        <Button variant="plain" url={disputeUrl} target="_blank">
                          {t("packs.openInShopifyAdmin")}
                        </Button>
                      )}
                    </InlineStack>
                  </MetadataRow>
                )}
                {fromTemplate && (
                  <MetadataRow label={t("packs.metaTemplate")}>
                    <Text as="span" variant="bodyMd">{pack.template_name ?? pack.name ?? "—"}</Text>
                  </MetadataRow>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* 2. Work card */}
        <Layout.Section>
          <div ref={workCardRef}>
            {isLibraryPack ? (
              /* Library-pack preview: read-only template definition. No upload, no save, no readiness. */
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">
                      {t("packs.templatePreviewTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("packs.templatePreviewBody")}
                    </Text>
                  </BlockStack>

                  {templateItemsBySection.length === 0 ? (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {t("packs.templateItemsEmpty")}
                    </Text>
                  ) : (
                    <BlockStack gap="500">
                      {templateItemsBySection.map((group) => (
                        <BlockStack key={group.title} gap="200">
                          <Text as="h4" variant="headingSm">
                            {group.title}
                          </Text>
                          <BlockStack gap="300">
                            {group.items.map((item) => {
                              const source = getFieldSource(item.key);
                              return (
                                <BlockStack key={`${group.title}-${item.key}`} gap="100">
                                  <InlineStack gap="200" blockAlign="center" wrap>
                                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                                      {item.label}
                                    </Text>
                                    <Badge tone={item.required ? "attention" : undefined}>
                                      {item.required
                                        ? t("packs.requiredBadge")
                                        : t("packs.optionalBadge")}
                                    </Badge>
                                    <Badge
                                      tone={
                                        source === "merchant_upload" ? "warning" : "info"
                                      }
                                    >
                                      {getFieldSourceLabel(source, t)}
                                    </Badge>
                                  </InlineStack>
                                  {item.guidance && (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {item.guidance}
                                    </Text>
                                  )}
                                </BlockStack>
                              );
                            })}
                          </BlockStack>
                        </BlockStack>
                      ))}
                    </BlockStack>
                  )}

                  <Divider />

                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("packs.templatePreviewFooter")}
                  </Text>
                </BlockStack>
              </Card>
            ) : (
              /* Dispute pack: full work card with checklist, upload, and collected evidence. */
              <Card>
                <BlockStack gap="500">
                  {/* Evidence needed */}
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      {t("packs.evidenceNeededTitle")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("packs.recommendedForDisputeDescription")}
                    </Text>
                    <BlockStack gap="100">
                      {checklistItems.map((item, idx) => (
                        <InlineStack key={idx} gap="200" blockAlign="center">
                          <Icon
                            source={item.present ? CheckCircleIcon : XCircleIcon}
                            tone={item.present ? "success" : "subdued"}
                          />
                          <Text as="p" variant="bodyMd">{item.label}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  </BlockStack>

                  <Divider />

                  {/* Upload */}
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      {t("packs.uploadSectionTitle")}
                    </Text>
                    <DropZone
                      onDrop={handleUpload}
                      allowMultiple
                      accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
                    >
                      {uploading ? (
                        <DropZone.FileUpload actionHint={t("packs.uploading")} />
                      ) : (
                        <DropZone.FileUpload actionHint={t("packs.clickToUpload")} />
                      )}
                    </DropZone>
                  </BlockStack>

                  {/* Collected evidence */}
                  {pack.evidence_items.length > 0 && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">
                        {t("packs.collectedEvidenceTitle")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("packs.evidenceItems", { count: pack.evidence_items.length })}
                      </Text>
                      <BlockStack gap="0">
                        {pack.evidence_items.map((item, idx) => (
                          <div key={item.id}>
                            {idx > 0 && <Divider />}
                            <div
                              onClick={() => toggleSection(item.id)}
                              style={{ cursor: "pointer", padding: "12px 0" }}
                            >
                              <InlineStack align="space-between" blockAlign="center">
                                <InlineStack gap="200" blockAlign="center">
                                  <Badge>{item.type}</Badge>
                                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                                    {item.label}
                                  </Text>
                                </InlineStack>
                                <InlineStack gap="200" blockAlign="center">
                                  <span onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      size="slim"
                                      variant="plain"
                                      onClick={() => copyEvidence(item)}
                                    >
                                      {copiedId === item.id
                                        ? t("packs.copied")
                                        : t("packs.copyToClipboard")}
                                    </Button>
                                  </span>
                                  <Icon
                                    source={
                                      expandedSections.has(item.id)
                                        ? ChevronUpIcon
                                        : ChevronDownIcon
                                    }
                                  />
                                </InlineStack>
                              </InlineStack>
                            </div>
                            <Collapsible
                              open={expandedSections.has(item.id)}
                              id={`section-${item.id}`}
                            >
                              <div
                                style={{
                                  padding: "8px 0 16px",
                                  maxHeight: 300,
                                  overflow: "auto",
                                }}
                              >
                                <pre
                                  style={{
                                    fontSize: 12,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-all",
                                  }}
                                >
                                  {JSON.stringify(item.payload, null, 2)}
                                </pre>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {t("packs.source", {
                                    source: item.source,
                                    date: formatDate(item.created_at),
                                  })}
                                </Text>
                              </div>
                            </Collapsible>
                          </div>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  </>
                )}
                </BlockStack>
              </Card>
            )}
          </div>
        </Layout.Section>

        {/* 3. Activity log (collapsed) + compliance */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack>
                <Button
                  variant="plain"
                  onClick={() => setShowAuditLog((v) => !v)}
                  disclosure={showAuditLog ? "up" : "down"}
                >
                  {showAuditLog
                    ? t("packs.activityLogHide")
                    : t("packs.activityLogShow", { count: pack.audit_events.length })}
                </Button>
              </InlineStack>
              <Collapsible open={showAuditLog} id="audit-log">
                <BlockStack gap="300">
                  {pack.audit_events.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("packs.activityLogEmpty")}
                    </Text>
                  ) : (
                    <BlockStack gap="150">
                      {pack.audit_events.map((evt) => {
                        const labelKey = EVENT_TYPE_KEYS[evt.event_type];
                        const label = labelKey
                          ? t(labelKey)
                          : evt.event_type
                              .replace(/_/g, " ")
                              .replace(/^./, (c) => c.toUpperCase());
                        return (
                          <InlineStack key={evt.id} gap="300" wrap>
                            <div style={{ minWidth: 180 }}>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatDate(evt.created_at)}
                              </Text>
                            </div>
                            <Text as="span" variant="bodySm">
                              {label}
                            </Text>
                          </InlineStack>
                        );
                      })}
                    </BlockStack>
                  )}
                  <Divider />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("packs.compliance")}
                  </Text>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showSaveWarning}
        onClose={() => setShowSaveWarning(false)}
        title={t("packs.confirmSaveTitle")}
        primaryAction={{
          content: t("packs.confirmSaveConfirm"),
          onAction: () => handleSave(true),
          destructive: true,
        }}
        secondaryActions={[{
          content: t("packs.confirmSaveCancel"),
          onAction: () => setShowSaveWarning(false),
        }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {t("packs.confirmSaveBody", { score })}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

/**
 * Embedded pack detail page — task-based workflow.
 *
 * Three sections:
 * 1. Header: status + next action
 * 2. Evidence builder (left) + submission sidebar (right)
 * 3. Activity log (collapsed)
 *
 * Library packs (no dispute) fall back to the existing template
 * preview / wizard view.
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
  Collapsible,
  Modal,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import { PackHeader } from "@/components/packs/detail/PackHeader";
import { EvidenceBuilderSection } from "@/components/packs/detail/EvidenceBuilderSection";
import { SubmissionSidebar } from "@/components/packs/detail/SubmissionSidebar";
import type {
  ChecklistItemV2,
  SubmissionReadiness,
  WaiveReason,
  WaivedItemRecord,
} from "@/lib/types/evidenceItem";
import styles from "./pack-detail.module.css";

/* ── Interfaces ── */

interface ChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
  collectable?: boolean;
  unavailableReason?: string;
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
  dispute_evidence_gid?: string | null;
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
  deadline?: string | null;
  checklist_v2?: ChecklistItemV2[] | null;
  submission_readiness?: string | null;
  waived_items?: WaivedItemRecord[] | null;
}

/* ── Helpers ── */

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

type FieldSource = "shopify_order" | "shopify_shipping" | "store_policy" | "merchant_upload";

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

function getSourceLabel(source: FieldSource): string {
  switch (source) {
    case "shopify_order":
    case "shopify_shipping":
      return "From Shopify order";
    case "store_policy":
      return "From store policies";
    case "merchant_upload":
      return "Uploaded";
  }
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

/* ── Page Component ── */

export default function PackPreviewPage() {
  const { packId } = useParams<{ packId: string }>();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const locale = useLocale();

  const [pack, setPack] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [replacingField, setReplacingField] = useState<string | null>(null);

  // Optimistic state: fields uploaded this session (moved to "already included")
  const [completedFields, setCompletedFields] = useState<Set<string>>(new Set());
  const [failedFields, setFailedFields] = useState<Map<string, string>>(new Map());

  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const builderRef = useRef<HTMLDivElement | null>(null);

  /* ── Data fetching ── */

  const fetchPack = useCallback(async () => {
    const res = await fetch(
      `/api/packs/${packId}?locale=${encodeURIComponent(locale)}`,
    );
    if (res.ok) {
      const data = await res.json();
      setPack(data);
      // Clear optimistic state when server catches up
      setCompletedFields(new Set());
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
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchPack]);

  /* ── Upload handler (per-item) ── */

  const handleItemUpload = useCallback(
    async (field: string, files: File[]) => {
      if (files.length === 0) return;
      setUploadingField(field);
      // Clear previous error for this field
      setFailedFields((prev) => {
        const next = new Map(prev);
        next.delete(field);
        return next;
      });

      try {
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("label", file.name);
          form.append("field", field);
          const res = await fetch(`/api/packs/${packId}/upload`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) throw new Error("Upload failed");
        }
        // Optimistic: move item to "already included"
        setCompletedFields((prev) => new Set(prev).add(field));
      } catch {
        setFailedFields((prev) => {
          const next = new Map(prev);
          next.set(field, "Upload failed — try again");
          return next;
        });
      } finally {
        setUploadingField(null);
        // Background sync
        fetchPack();
      }
    },
    [packId, fetchPack],
  );

  /* ── Replace file handler ── */

  const handleReplaceFile = useCallback(
    async (field: string, files: File[]) => {
      if (files.length === 0) return;
      setReplacingField(field);
      try {
        const form = new FormData();
        form.append("file", files[0]);
        form.append("label", files[0].name);
        form.append("field", field);
        await fetch(`/api/packs/${packId}/upload`, {
          method: "POST",
          body: form,
        });
      } finally {
        setReplacingField(null);
        fetchPack();
      }
    },
    [packId, fetchPack],
  );

  /* ── Waive / unwaive handlers ── */

  const handleWaive = useCallback(
    async (field: string, reason: WaiveReason) => {
      await fetch(`/api/packs/${packId}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, reason }),
      });
      fetchPack();
    },
    [packId, fetchPack],
  );

  const handleUnwaive = useCallback(
    async (field: string) => {
      await fetch(
        `/api/packs/${packId}/waive?field=${encodeURIComponent(field)}`,
        { method: "DELETE" },
      );
      fetchPack();
    },
    [packId, fetchPack],
  );

  /* ── PDF actions ── */

  const handleExportPdf = useCallback(async () => {
    setRendering(true);
    await fetch(`/api/packs/${packId}/render-pdf`, { method: "POST" });
    pollRef.current = setInterval(fetchPack, 3000);
    await fetchPack();
    setRendering(false);
  }, [packId, fetchPack]);

  const handleDownload = useCallback(async () => {
    const res = await fetch(`/api/packs/${packId}/download`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, "_blank");
    }
  }, [packId]);

  /* ── Save handler ── */

  const handleSave = useCallback(
    async (confirmed = false) => {
      if (!pack) return;
      const currentScore = pack.completeness_score ?? 0;
      if (pack.status === "blocked" || currentScore === 0) {
        return;
      }
      if (!confirmed) {
        setShowConfirmModal(true);
        return;
      }
      setSaving(true);
      try {
        const body = { confirmWarnings: true };
        const res = await fetch(`/api/packs/${packId}/save-to-shopify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("[save-to-shopify] API error:", res.status, data);
        }
      } catch (err) {
        console.error("[save-to-shopify] fetch error:", err);
      }
      setShowConfirmModal(false);
      await fetchPack();
      setSaving(false);
    },
    [pack, packId, fetchPack],
  );

  /* ── Scroll to builder ── */

  const scrollToFirstMissing = useCallback(() => {
    if (!pack) return;
    // V2: find first missing blocker, then first missing critical
    const v2 = (pack.checklist_v2 ?? pack.checklist ?? []) as (ChecklistItemV2 | ChecklistItem)[];
    const firstMissing = v2.find((c) => {
      if ("status" in c) {
        return c.status === "missing" && !completedFields.has(c.field);
      }
      return (c.required ?? false) && !c.present && !completedFields.has(c.field);
    });
    if (firstMissing) {
      setFocusField(firstMissing.field);
    } else {
      builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [pack, completedFields]);

  /* ── Loading / not found ── */

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
      <Page
        title={t("nav.playbooks")}
        backAction={{ content: t("packs.backToPacks"), url: "/app/packs" }}
      >
        <Banner tone="critical">{t("packs.packNotFound")}</Banner>
      </Page>
    );
  }

  /* ── Derived state ── */

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;
  const isLibraryPack = pack.dispute_id == null;
  const isSaved = pack.status === "saved_to_shopify";
  const isReadOnly = isSaved;
  const disputeTypeKey = pack.dispute_type
    ? pack.dispute_type.toUpperCase().replace(/\s+/g, "_")
    : "GENERAL";
  const disputeTypeRaw = t(
    `packs.disputeTypeLabel.${disputeTypeKey}` as Parameters<typeof t>[0],
  );
  const disputeTypeLabel = pack.dispute_type
    ? disputeTypeRaw.includes("disputeTypeLabel.")
      ? pack.dispute_type.replace(/_/g, " ")
      : disputeTypeRaw
    : "—";

  const phaseLabel =
    pack.dispute_phase === "inquiry"
      ? t("packs.phaseInquiry")
      : pack.dispute_phase === "chargeback"
        ? t("packs.phaseChargeback")
        : "—";

  const disputeUrl =
    pack.shop_domain && pack.dispute_evidence_gid && pack.dispute_id
      ? getShopifyDisputeUrl(pack.shop_domain, pack.dispute_evidence_gid)
      : null;

  const backUrl = withShopParams(
    isLibraryPack ? "/app/packs" : `/app/disputes/${pack.dispute_id}`,
    searchParams,
  );
  const backLabel = isLibraryPack
    ? t("packs.backToPacks")
    : t("disputes.backToDisputes");
  const pageTitle = isLibraryPack
    ? (pack.name ?? t("packs.playbookTitle"))
    : (pack.name ?? t("packs.evidencePackTitle"));

  const subtitle = isLibraryPack
    ? t("packs.subtitleLibrary", { type: disputeTypeLabel })
    : t("packs.subtitleDispute", { type: disputeTypeLabel, phase: phaseLabel });

  /* ── V2 checklist derivation (with v1→v2 shim + optimistic state) ── */

  // Use v2 checklist from API if available; fall back to v1→v2 conversion
  const v2Checklist: ChecklistItemV2[] = (() => {
    if (pack.checklist_v2 && Array.isArray(pack.checklist_v2) && pack.checklist_v2.length > 0) {
      return pack.checklist_v2 as ChecklistItemV2[];
    }
    // V1→V2 shim: derive from legacy checklist
    const v1 = (pack.checklist ?? []) as ChecklistItem[];
    return v1.map((c): ChecklistItemV2 => ({
      field: c.field,
      label: c.label,
      status: c.present ? "available" : (c.collectable ?? true) ? "missing" : "unavailable",
      priority: (c.required ?? false) ? "critical" : "recommended",
      blocking: false,
      source: "auto_shopify",
      unavailableReason: c.unavailableReason,
    }));
  })();

  // Apply optimistic state: completedFields → status: "available"
  const checklist: ChecklistItemV2[] = v2Checklist.map((c) => {
    if (completedFields.has(c.field) && c.status === "missing") {
      return { ...c, status: "available" as const };
    }
    return c;
  });

  // Derive readiness from API or checklist
  const readiness: SubmissionReadiness = (() => {
    if (isSaved) return "submitted";
    // API v2 readiness, adjusted for optimistic state
    const missingBlockers = checklist.filter(
      (c) => c.blocking && c.status === "missing",
    );
    if (missingBlockers.length > 0) return "blocked";
    const missingCritical = checklist.filter(
      (c) => c.priority === "critical" && c.status === "missing",
    );
    if (missingCritical.length > 0) return "ready_with_warnings";
    return "ready";
  })();

  const blockerCount = checklist.filter(
    (c) => c.blocking && c.status === "missing",
  ).length;
  const warningCount = checklist.filter(
    (c) => c.priority === "critical" && !c.blocking && c.status === "missing",
  ).length;

  // Build "already included" items from evidence_items + optimistically completed
  const includedItems = [
    ...pack.evidence_items.map((ei) => ({
      label: ei.label,
      sourceLabel: getSourceLabel(getFieldSource(ei.type)),
      timestamp: ei.source === "manual" ? formatDate(ei.created_at) : undefined,
      canReplace: ei.source === "manual",
      field: ei.type,
    })),
    ...Array.from(completedFields)
      .filter(
        (field) => !pack.evidence_items.some((ei) => ei.type === field),
      )
      .map((field) => {
        const cl = checklist.find((c) => c.field === field);
        return {
          label: cl?.label ?? field,
          sourceLabel: "Uploaded",
          timestamp: "Added just now",
          canReplace: true,
          field,
        };
      }),
    // Checklist items marked available but not in evidence_items or completedFields
    ...checklist
      .filter(
        (c) =>
          c.status === "available" &&
          !pack.evidence_items.some((ei) => ei.type === c.field) &&
          !completedFields.has(c.field),
      )
      .map((c) => ({
        label: c.label,
        sourceLabel: getSourceLabel(getFieldSource(c.field)),
        canReplace: false,
        field: c.field,
      })),
  ];

  // Counts for confirm modal
  const totalRecommended = checklist.filter(
    (c) => c.priority !== "critical" && c.status !== "unavailable",
  ).length;
  const recommendedComplete = checklist.filter(
    (c) =>
      c.priority !== "critical" &&
      (c.status === "available" || c.status === "waived"),
  ).length;

  /* ── Library pack: template preview ── */

  const templateItemsBySection = (() => {
    const groups = new Map<string, TemplateItemRow[]>();
    for (const item of pack.template_items ?? []) {
      const key = item.section_title ?? "";
      const list = groups.get(key);
      if (list) list.push(item);
      else groups.set(key, [item]);
    }
    return Array.from(groups.entries()).map(([title, items]) => ({
      title,
      items,
    }));
  })();

  /* ── Page-level primary action ── */

  const primaryAction = (() => {
    if (isLibraryPack) {
      return {
        content: t("packs.primaryBrowseTemplates"),
        url: withShopParams("/app/packs", searchParams),
      };
    }
    if (isSaved && disputeUrl) {
      return {
        content: t("packs.openInShopifyAdmin"),
        url: disputeUrl,
        external: true,
      };
    }
    if (readiness === "blocked") {
      return {
        content: t("packs.ctaAddRequired"),
        onAction: scrollToFirstMissing,
      };
    }
    return {
      content: saving ? t("packs.saving") : t("packs.ctaSubmit"),
      onAction: () => handleSave(),
      loading: saving || pack.status === "saving",
      disabled: isBuilding,
    };
  })();

  return (
    <Page
      title={pageTitle}
      subtitle={subtitle}
      backAction={{ content: backLabel, url: backUrl }}
      primaryAction={primaryAction}
    >
      <Layout>
        {isLibraryPack ? (
          /* ── Library pack: template preview (preserved) ── */
          <>
            <Layout.Section>
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
                                <BlockStack
                                  key={`${group.title}-${item.key}`}
                                  gap="100"
                                >
                                  <InlineStack
                                    gap="200"
                                    blockAlign="center"
                                    wrap
                                  >
                                    <Text
                                      as="span"
                                      variant="bodyMd"
                                      fontWeight="semibold"
                                    >
                                      {item.label}
                                    </Text>
                                    <Badge
                                      tone={
                                        item.required ? "attention" : undefined
                                      }
                                    >
                                      {item.required
                                        ? t("packs.requiredBadge")
                                        : t("packs.optionalBadge")}
                                    </Badge>
                                    <Badge
                                      tone={
                                        source === "merchant_upload"
                                          ? "warning"
                                          : "info"
                                      }
                                    >
                                      {getFieldSourceLabel(source, t)}
                                    </Badge>
                                  </InlineStack>
                                  {item.guidance && (
                                    <Text
                                      as="p"
                                      variant="bodySm"
                                      tone="subdued"
                                    >
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
            </Layout.Section>
          </>
        ) : (
          /* ── Dispute pack: task workflow ── */
          <>
            {/* Section 1: Header */}
            <Layout.Section>
              <PackHeader
                status={pack.status}
                score={score}
                readiness={readiness}
                warningCount={warningCount}
                blockerCount={blockerCount}
                isBuilding={isBuilding}
                savedAt={pack.saved_to_shopify_at}
                saveFailed={pack.status === "save_failed"}
                disputeUrl={disputeUrl}
                disputePhase={pack.dispute_phase ?? null}
                deadline={pack.deadline ?? null}
                onScrollToBuilder={scrollToFirstMissing}
                onSave={() => handleSave()}
                saving={saving || pack.status === "saving"}
              />
            </Layout.Section>

            {/* Section 2: Two-column layout */}
            <Layout.Section>
              <div className={styles.twoColumnLayout}>
                {/* Left: Evidence Builder */}
                <div className={styles.leftColumn} ref={builderRef}>
                  <EvidenceBuilderSection
                    checklist={checklist}
                    includedItems={includedItems}
                    evidenceItems={pack.evidence_items}
                    onUpload={handleItemUpload}
                    uploadingField={uploadingField}
                    failedFields={failedFields}
                    onReplace={handleReplaceFile}
                    replacingField={replacingField}
                    onWaive={handleWaive}
                    onUnwaive={handleUnwaive}
                    focusField={focusField}
                    onFocusHandled={() => setFocusField(null)}
                    readOnly={isReadOnly}
                  />
                </div>

                {/* Right: Sidebar */}
                <div className={styles.rightColumn}>
                  <SubmissionSidebar
                    readiness={readiness}
                    completenessScore={score}
                    warningCount={warningCount}
                    onSave={() => handleSave()}
                    onExportPdf={handleExportPdf}
                    onDownload={handleDownload}
                    saving={saving || pack.status === "saving"}
                    rendering={rendering}
                    hasPdf={Boolean(pack.pdf_path)}
                    hasPdfJob={Boolean(pack.active_pdf_job)}
                    readOnly={isReadOnly}
                    disputeUrl={disputeUrl}
                  />
                </div>
              </div>
            </Layout.Section>
          </>
        )}

        {/* Activity log (collapsed) */}
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
                    : t("packs.activityLogShow", {
                        count: pack.audit_events.length,
                      })}
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

      {/* Confirmation modal */}
      <Modal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title={t("packs.confirmSubmitTitle")}
        primaryAction={{
          content: t("packs.confirmSubmitConfirm"),
          onAction: () => handleSave(true),
        }}
        secondaryActions={[
          {
            content: t("packs.confirmSubmitCancel"),
            onAction: () => setShowConfirmModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              {t("packs.confirmSubmitBody")}
            </Text>
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {t("packs.confirmSubmitRequired")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("packs.confirmSubmitRecommended", {
                done: recommendedComplete,
                total: totalRecommended,
              })}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
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
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@shopify/polaris-icons";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";

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

interface PackData {
  id: string;
  shop_id: string;
  name?: string;
  dispute_id: string | null;
  dispute_type?: string | null;
  shop_domain?: string | null;
  dispute_gid?: string | null;
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

const SUGGESTED_EVIDENCE_KEYS: Record<string, string[]> = {
  FRAUD: ["packs.suggestedOrderConfirmation", "packs.suggestedTracking", "packs.suggestedBillingShipping", "packs.suggestedCustomerComm", "packs.suggestedStorePolicy", "packs.suggestedFraudScreening", "packs.suggestedMetadata"],
  FRAUDULENT: ["packs.suggestedOrderConfirmation", "packs.suggestedTracking", "packs.suggestedBillingShipping", "packs.suggestedCustomerComm", "packs.suggestedStorePolicy", "packs.suggestedFraudScreening", "packs.suggestedMetadata"],
  PNR: ["packs.suggestedOrderConfirmation", "packs.suggestedTracking", "packs.suggestedBillingShipping", "packs.suggestedCustomerComm", "packs.suggestedStorePolicy"],
  PRODUCT_NOT_RECEIVED: ["packs.suggestedOrderConfirmation", "packs.suggestedTracking", "packs.suggestedBillingShipping", "packs.suggestedCustomerComm", "packs.suggestedStorePolicy"],
  NOT_AS_DESCRIBED: ["packs.suggestedOrderConfirmation", "packs.suggestedRefundPolicy", "packs.suggestedCustomerComm", "packs.suggestedStorePolicy"],
  DUPLICATE: ["packs.suggestedOrderConfirmation", "packs.suggestedBillingShipping", "packs.suggestedCustomerComm"],
  SUBSCRIPTION: ["packs.suggestedOrderConfirmation", "packs.suggestedRefundPolicy", "packs.suggestedCustomerComm"],
  REFUND: ["packs.suggestedOrderConfirmation", "packs.suggestedRefundPolicy", "packs.suggestedCustomerComm"],
  GENERAL: ["packs.suggestedOrderConfirmation", "packs.suggestedTracking", "packs.suggestedCustomerComm", "packs.suggestedRefundPolicy", "packs.suggestedStorePolicy"],
};

function getReadinessStateLabel(score: number, t: (key: string) => string): string {
  if (score >= 90) return t("packs.readinessReadyToReview");
  if (score >= 60) return t("packs.readinessNearlyReady");
  if (score >= 25) return t("packs.readinessInProgress");
  return t("packs.readinessJustStarted");
}

function getStatusBanner(
  pack: PackData,
  t: (key: string) => string
): { tone: "critical" | "warning" | "success" | "info"; message: string } {
  if (pack.status === "saved_to_shopify")
    return { tone: "success", message: t("packs.statusSaved") };
  if (pack.status === "ready")
    return { tone: "info", message: t("packs.statusReady") };
  if (pack.source === "TEMPLATE" && !pack.saved_to_shopify_at)
    return { tone: "info", message: t("packs.statusTemplateDraft") };
  return { tone: "warning", message: t("packs.statusDraft") };
}

export default function PackPreviewPage() {
  const { packId } = useParams<{ packId: string }>();
  const t = useTranslations();
  const [pack, setPack] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const fetchPack = useCallback(async () => {
    const res = await fetch(`/api/packs/${packId}`);
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
  }, [packId]);

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

  if (loading) {
    return (
      <Page title={t("packs.title")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!pack) {
    return (
      <Page title={t("packs.title")} backAction={{ content: t("packs.backToDisputes"), url: "/app/disputes" }}>
        <Banner tone="critical">{t("packs.packNotFound")}</Banner>
      </Page>
    );
  }

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;
  const isLibraryPack = pack.dispute_id == null;
  const fromTemplate = pack.source === "TEMPLATE" && (pack.template_name ?? pack.name);
  const disputeTypeKey = pack.dispute_type ? pack.dispute_type.toUpperCase().replace(/\s+/g, "_") : "GENERAL";
  const disputeTypeLabel = pack.dispute_type
    ? (t(`packs.disputeTypeLabel.${disputeTypeKey}`) as string) || pack.dispute_type.replace(/_/g, " ")
    : null;
  const suggestedKeys = SUGGESTED_EVIDENCE_KEYS[disputeTypeKey] ?? SUGGESTED_EVIDENCE_KEYS.GENERAL;
  const suggestedLabels = suggestedKeys.map((key) => t(key));
  const statusBanner = getStatusBanner(pack, t);

  const backUrl = isLibraryPack ? "/app/packs" : `/app/disputes/${pack.dispute_id}`;
  const backLabel = isLibraryPack ? t("packs.backToPacks") : t("disputes.backToDisputes");

  return (
    <Page
      title={pack.name ?? t("packs.packTitle", { id: pack.id.slice(0, 8) })}
      subtitle={t("packs.created", { date: formatDate(pack.created_at), creator: pack.created_by ?? "system" })}
      backAction={{ content: backLabel, url: backUrl }}
    >
      <Layout>
        {/* A. Hero */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h1" variant="headingLg">{t("packs.detailHeroTitle")}</Text>
              <Text as="p" variant="bodyMd" tone="subdued">{t("packs.detailHeroDescription")}</Text>
              <InlineStack gap="400" wrap>
                {pack.name && <Text as="span" variant="bodySm" fontWeight="semibold">{pack.name}</Text>}
                {disputeTypeLabel && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("packs.detailDisputeType")} {disputeTypeLabel}
                  </Text>
                )}
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">{t("packs.detailStatus")}</Text>
                  <Badge tone={statusTone(pack.status)}>{pack.status.replace(/_/g, " ")}</Badge>
                </InlineStack>
                <Text as="span" variant="bodySm" tone="subdued">
                  {t("packs.detailCreated")} {formatDate(pack.created_at)}
                </Text>
              </InlineStack>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">1. {t("packs.detailWorkflow1")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">2. {t("packs.detailWorkflow2")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">3. {t("packs.detailWorkflow3")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">4. {t("packs.detailWorkflow4")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">5. {t("packs.detailWorkflowOptional")}</Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* B. Template continuity */}
        {fromTemplate && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">{t("packs.startedFromTemplate")}</Text>
                  <Badge tone="info">{t("packs.templateBadge")}</Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd">{t("packs.basedOnTemplate", { name: pack.template_name ?? pack.name ?? "" })}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("packs.templateContinuityDescription")}</Text>
                <Button url="/app/packs" variant="plain">{t("packs.browseTemplates")}</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* C. Recommended evidence */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("packs.recommendedForDispute")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.recommendedForDisputeDescription")}</Text>
              <Text as="p" variant="bodySm" fontWeight="medium">{t("packs.useChecklistAsGuide")}</Text>
              <Divider />
              {(pack.checklist?.length
                ? pack.checklist.map((c) => ({ label: c.label, present: c.present }))
                : suggestedLabels.map((label) => ({ label, present: false }))
              ).map((item, idx) => (
                <InlineStack key={idx} gap="200" blockAlign="center">
                  <Icon source={item.present ? CheckCircleIcon : XCircleIcon} tone={item.present ? "success" : "subdued"} />
                  <Text as="p" variant="bodyMd">{item.label}</Text>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* D. Readiness */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">{t("packs.packReadiness")}</Text>
                <Text as="p" variant="bodyMd" fontWeight="bold">{score}%</Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.readinessHelper")}</Text>
              <ProgressBar
                progress={score}
                tone={score >= 80 ? "success" : score >= 50 ? "highlight" : "critical"}
                size="small"
              />
              <Text as="p" variant="bodySm" fontWeight="medium" tone="subdued">
                {getReadinessStateLabel(score, t)}
              </Text>
              {pack.blockers && pack.blockers.length > 0 && (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm" fontWeight="bold">
                    {t("packs.blockersLabel", { count: pack.blockers.length, list: pack.blockers.join(", ") })}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {isBuilding && (
          <Layout.Section>
            <Banner tone="info">{t("packs.building")}</Banner>
          </Layout.Section>
        )}

        {/* E. Step 1 — Upload */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">1</Badge>
                <Text as="h2" variant="headingMd">{t("packs.step1Title")}</Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.step1Description")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.step1FileRestrictions")}</Text>
              {fromTemplate && <Text as="p" variant="bodySm" fontWeight="medium">{t("packs.step1MatchChecklist")}</Text>}
              <DropZone onDrop={handleUpload} allowMultiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv">
                {uploading ? (
                  <DropZone.FileUpload actionHint={t("packs.uploading")} />
                ) : (
                  <DropZone.FileUpload actionHint={pack.evidence_items.length === 0 ? t("packs.step1EmptyState") : t("packs.clickToUpload")} />
                )}
              </DropZone>
            </BlockStack>
          </Card>
        </Layout.Section>

        {pack.evidence_items.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{t("packs.evidenceItems", { count: pack.evidence_items.length })}</Text>
                <Divider />
                {pack.evidence_items.map((item) => (
                  <div key={item.id}>
                    <div onClick={() => toggleSection(item.id)} style={{ cursor: "pointer" }}>
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge>{item.type}</Badge>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <span onClick={(e) => e.stopPropagation()}>
                            <Button size="slim" variant="plain" onClick={() => copyEvidence(item)}>
                              {copiedId === item.id ? t("packs.copied") : t("packs.copyToClipboard")}
                            </Button>
                          </span>
                          <Icon source={expandedSections.has(item.id) ? ChevronUpIcon : ChevronDownIcon} />
                        </InlineStack>
                      </InlineStack>
                    </div>
                    <Collapsible open={expandedSections.has(item.id)} id={`section-${item.id}`}>
                      <div style={{ padding: "12px 0", maxHeight: "300px", overflow: "auto" }}>
                        <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(item.payload, null, 2)}
                        </pre>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("packs.source", { source: item.source, date: formatDate(item.created_at) })}
                        </Text>
                      </div>
                    </Collapsible>
                    <Divider />
                  </div>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* F. Step 2 — Save to Shopify */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">2</Badge>
                <Text as="h2" variant="headingMd">{t("packs.step2Title")}</Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.step2Description")}</Text>
              {pack.status === "saved_to_shopify" ? (
                <>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text as="p" variant="bodyMd" fontWeight="semibold">{t("packs.savedToShopifyBadge")}</Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">{t("packs.step2AfterSave")}</Text>
                  {pack.saved_to_shopify_at && (
                    <Text as="p" variant="bodySm" tone="subdued">{t("packs.lastSavedToShopify", { date: formatDate(pack.saved_to_shopify_at) })}</Text>
                  )}
                  {disputeUrl && <Button url={disputeUrl} target="_blank">{t("packs.openInShopifyAdmin")}</Button>}
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    loading={saving || pack.status === "saving"}
                    disabled={isBuilding}
                    onClick={async () => {
                      setSaving(true);
                      await fetch(`/api/packs/${packId}/save-to-shopify`, { method: "POST" });
                      await fetchPack();
                      setSaving(false);
                    }}
                  >
                    {pack.status === "saving" || saving ? t("packs.saving") : t("packs.saveToShopify")}
                  </Button>
                  {pack.status === "save_failed" && (
                    <Banner tone="critical">{t("packs.saveFailed")}</Banner>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* G. Step 3 — Submit in Shopify Admin */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">3</Badge>
                <Text as="h2" variant="headingMd">{t("packs.step3Title")}</Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.step3Description")}</Text>
              {disputeUrl && <Button url={disputeUrl} target="_blank">{t("packs.openInShopifyAdmin")}</Button>}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* H. Optional — Export PDF */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("packs.stepOptionalPdfTitle")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.stepOptionalPdfDescription")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("packs.stepOptionalPdfNote")}</Text>
              {pack.active_pdf_job ? (
                <Text as="p" variant="bodySm">{t("packs.generatingPdf")}</Text>
              ) : (
                <InlineStack gap="200">
                  <Button onClick={handleExportPdf} loading={rendering}>
                    {pack.pdf_path ? t("packs.reRenderPdf") : t("packs.exportPdf")}
                  </Button>
                  {pack.pdf_path && (
                    <Button variant="primary" onClick={handleDownload}>
                      {t("packs.downloadPdfReady")}
                    </Button>
                  )}
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Status banner */}
        <Layout.Section>
          <Banner tone={statusBanner.tone}>{statusBanner.message}</Banner>
        </Layout.Section>

        {pack.audit_events.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{t("packs.auditLog")}</Text>
                <Divider />
                {pack.audit_events.map((evt) => (
                  <BlockStack key={evt.id} gap="100">
                    <Text as="p" variant="bodySm">{evt.event_type.replace(/_/g, " ")} ({evt.actor_type})</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{formatDate(evt.created_at)}</Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <Banner tone="info">{t("packs.compliance")}</Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

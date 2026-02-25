"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  ProgressBar,
  Collapsible,
  Icon,
  DropZone,
  LegacyStack,
  Thumbnail,
  List,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@shopify/polaris-icons";

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
  dispute_id: string;
  status: string;
  completeness_score: number | null;
  checklist: ChecklistItem[] | null;
  blockers: string[] | null;
  recommended_actions: string[] | null;
  pack_json: Record<string, unknown> | null;
  pdf_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  evidence_items: EvidenceItem[];
  audit_events: AuditEvent[];
  active_build_job: { id: string; status: string } | null;
  active_pdf_job: { id: string; status: string } | null;
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

export default function PackPreviewPage() {
  const { packId } = useParams<{ packId: string }>();
  const [pack, setPack] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
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

  const handleRenderPdf = async () => {
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
      <Page title="Evidence Pack">
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  if (!pack) {
    return (
      <Page title="Evidence Pack" backAction={{ content: "Back", url: "/app/disputes" }}>
        <Banner tone="critical">Pack not found.</Banner>
      </Page>
    );
  }

  const isBuilding = pack.status === "queued" || pack.status === "building";
  const score = pack.completeness_score ?? 0;

  return (
    <Page
      title={`Pack ${pack.id.slice(0, 8)}`}
      subtitle={`Created ${formatDate(pack.created_at)} · ${pack.created_by ?? "system"}`}
      backAction={{ content: "Dispute", url: `/app/disputes/${pack.dispute_id}` }}
    >
      <Layout>
        {isBuilding && (
          <Layout.Section>
            <Banner tone="info">
              Building evidence pack... This page refreshes automatically.
            </Banner>
          </Layout.Section>
        )}

        {/* Status + Score */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Pack Status</Text>
                <Badge tone={statusTone(pack.status)}>
                  {pack.status.replace(/_/g, " ")}
                </Badge>
              </InlineStack>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodySm" tone="subdued">Completeness</Text>
                  <Text as="p" variant="bodyMd" fontWeight="bold">{score}%</Text>
                </InlineStack>
                <ProgressBar
                  progress={score}
                  tone={score >= 80 ? "success" : score >= 50 ? "highlight" : "critical"}
                  size="small"
                />
              </BlockStack>
              {pack.blockers && pack.blockers.length > 0 && (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm" fontWeight="bold">
                    {pack.blockers.length} blocker(s): {pack.blockers.join(", ")}
                  </Text>
                </Banner>
              )}
              {pack.recommended_actions && pack.recommended_actions.length > 0 && (
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    Recommended: {pack.recommended_actions.join(", ")}
                  </Text>
                </Banner>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Checklist */}
        {pack.checklist && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Evidence Checklist</Text>
                <Divider />
                {pack.checklist.map((item) => (
                  <InlineStack key={item.field} gap="200" align="start" blockAlign="center">
                    <Icon
                      source={item.present ? CheckCircleIcon : XCircleIcon}
                      tone={item.present ? "success" : item.required ? "critical" : "subdued"}
                    />
                    <BlockStack gap="0">
                      <Text as="p" variant="bodyMd">
                        {item.label}
                        {item.required && !item.present && (
                          <Badge tone="critical" size="small">required</Badge>
                        )}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Evidence Sections */}
        {pack.evidence_items.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Evidence Items ({pack.evidence_items.length})
                </Text>
                <Divider />
                {pack.evidence_items.map((item) => (
                  <div key={item.id}>
                    <div
                      onClick={() => toggleSection(item.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge>{item.type}</Badge>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {item.label}
                          </Text>
                        </InlineStack>
                        <Icon source={expandedSections.has(item.id) ? ChevronUpIcon : ChevronDownIcon} />
                      </InlineStack>
                    </div>
                    <Collapsible
                      open={expandedSections.has(item.id)}
                      id={`section-${item.id}`}
                    >
                      <div style={{ padding: "12px 0", maxHeight: "300px", overflow: "auto" }}>
                        <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(item.payload, null, 2)}
                        </pre>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Source: {item.source} · Added {formatDate(item.created_at)}
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

        {/* File Upload */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Upload Evidence</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Drag files here or click to upload supporting evidence (images, PDFs, up to 10 MB).
              </Text>
              <DropZone
                onDrop={handleUpload}
                allowMultiple
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
              >
                {uploading ? (
                  <DropZone.FileUpload actionHint="Uploading..." />
                ) : (
                  <DropZone.FileUpload />
                )}
              </DropZone>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Audit Log */}
        {pack.audit_events.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Audit Log</Text>
                <Divider />
                {pack.audit_events.map((evt) => (
                  <InlineStack key={evt.id} gap="200" blockAlign="start">
                    <Text as="p" variant="bodySm" tone="subdued" breakWord>
                      {formatDate(evt.created_at)}
                    </Text>
                    <BlockStack gap="0">
                      <Text as="p" variant="bodySm">
                        {evt.event_type.replace(/_/g, " ")} ({evt.actor_type})
                      </Text>
                    </BlockStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* PDF Actions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">PDF Export</Text>
              <InlineStack gap="200">
                {pack.active_pdf_job ? (
                  <Banner tone="info">
                    Rendering PDF... This page refreshes automatically.
                  </Banner>
                ) : (
                  <>
                    <Button onClick={handleRenderPdf} loading={rendering}>
                      {pack.pdf_path ? "Re-render PDF" : "Render PDF"}
                    </Button>
                    {pack.pdf_path && (
                      <Button variant="primary" onClick={handleDownload}>
                        Download PDF
                      </Button>
                    )}
                  </>
                )}
              </InlineStack>
              {pack.pdf_path && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Last rendered: {pack.pdf_path.split("/").pop()?.replace(/-/g, ":")}
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Completeness Gate */}
        {pack.completeness_score != null && pack.completeness_score < 60 && (
          <Layout.Section>
            <Banner tone="warning" title="Missing recommended evidence">
              <p>
                This pack&apos;s completeness is {pack.completeness_score}% (below 60% threshold).
                Missing evidence may weaken your dispute response.
              </p>
              {pack.checklist && (
                <ul style={{ marginTop: 8, paddingLeft: 16 }}>
                  {(pack.checklist as ChecklistItem[])
                    .filter((c) => !c.present && c.required)
                    .map((c) => (
                      <li key={c.field} style={{ marginBottom: 2 }}>
                        {c.label} (required)
                      </li>
                    ))}
                </ul>
              )}
            </Banner>
          </Layout.Section>
        )}

        {/* Compliance */}
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

"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Collapsible,
  Divider,
  Modal,
  Select,
  TextField,
  Icon,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ClipboardIcon,
  ExternalIcon,
  InfoIcon,
  FileIcon,
  ImageIcon,
  EmailIcon,
} from "@shopify/polaris-icons";
import { useTranslations } from "next-intl";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type {
  SubmissionField,
  WorkspaceAttachment,
} from "../workspace-components/types";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

function strengthLabel(s: string): string {
  if (s === "strong") return "Strong";
  if (s === "moderate") return "Medium";
  return "Weak";
}

/* ── Figma card chrome (matches Overview/Evidence) ── */
const cardChrome: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #E1E3E5",
  borderRadius: 8,
  padding: 20,
  boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
};

const blueOutlinedCard: CSSProperties = {
  background: "#ffffff",
  border: "2px solid #005BD3",
  borderRadius: 8,
  padding: 20,
};

/* ── Flat pill (matches the rest of the embedded redesign) ── */
const PILL_STYLE: CSSProperties = {
  padding: "2px 8px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
};

function readinessPillColors(
  isReadOnly: boolean,
  readiness: string,
  isWeak: boolean,
): { bg: string; color: string; label: string } {
  if (isReadOnly) return { bg: "#DBEAFE", color: "#1E40AF", label: "Submitted" };
  if (readiness === "blocked") return { bg: "#FEE2E2", color: "#991B1B", label: "Blocked" };
  if (isWeak) return { bg: "#FEF3C7", color: "#92400E", label: "Risky" };
  return { bg: "#D1FAE5", color: "#065F46", label: "Ready to submit" };
}

function strengthPillColors(s: string): { bg: string; color: string } {
  if (s === "strong") return { bg: "#D1FAE5", color: "#065F46" };
  if (s === "moderate") return { bg: "#FEF3C7", color: "#92400E" };
  return { bg: "#FEE2E2", color: "#991B1B" };
}

/* ── Submission preview helpers ── */

const submissionMonoBlockStyle: CSSProperties = {
  background: "#f8fafc",
  borderRadius: "8px",
  padding: "20px 24px",
  border: "1px solid #e2e8f0",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "13px",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  color: "#1a1a1a",
};

function submissionFieldHeading(field: SubmissionField): string {
  if (field.shopifyFieldName === "uncategorizedText") {
    return "Additional evidence and supporting documents";
  }
  return field.shopifyFieldLabel;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "—";
  const KB = 1024;
  const MB = KB * 1024;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

function attachmentTypeLabel(mime: string | null | undefined): string {
  if (!mime) return "File";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("text/")) return "Text";
  if (mime === "text/csv") return "CSV";
  if (mime.startsWith("video/")) return "Video";
  return mime.split("/").pop()?.toUpperCase() ?? "File";
}

function attachmentIconFor(mime: string | null | undefined): typeof FileIcon {
  if (!mime) return FileIcon;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime === "message/rfc822" || mime.includes("email")) return EmailIcon;
  return FileIcon;
}

function formatSubmittedTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${date} at ${time}`;
  } catch {
    return iso;
  }
}

/* ── "What Was Sent" structured topic groups ──
 *
 * Soft-derives a small set of topic groups from existing pack data so the
 * merchant gets the Figma-style accordion view without any new backend.
 * Each builder returns null when its source data is empty so the topic
 * is silently skipped.
 */

type Topic = {
  id: string;
  title: string;
  summary: string;
  body: Array<{ label: string; value: string; tone?: "success" | "subdued" }>;
};

function buildTopics(
  pack: NonNullable<Workspace["data"]>["pack"],
  fields: SubmissionField[],
): Topic[] {
  const topics: Topic[] = [];
  const itemsByField = pack?.evidenceItemsByField ?? {};

  // Helpers to read fieldsProvided payloads safely.
  const payloadFor = (field: string): Record<string, unknown> | null => {
    const item = (itemsByField as Record<string, { payload?: unknown } | undefined>)[field];
    if (!item || typeof item.payload !== "object" || item.payload === null) return null;
    return item.payload as Record<string, unknown>;
  };

  // 1. Order Summary — from order_confirmation payload.
  const order = payloadFor("order_confirmation");
  if (order) {
    const orderName = typeof order.orderName === "string" ? order.orderName : null;
    const totals = (order.totals as Record<string, unknown> | undefined) ?? null;
    const total = totals
      ? `${(totals.currency as string) ?? ""} ${(totals.total as string) ?? ""}`.trim()
      : null;
    const created =
      typeof order.createdAt === "string"
        ? new Date(order.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })
        : null;
    const summaryParts = [orderName, total, created].filter(Boolean);
    if (summaryParts.length > 0) {
      const body: Topic["body"] = [];
      if (orderName) body.push({ label: "Order ID", value: orderName });
      if (total) body.push({ label: "Amount", value: total });
      if (typeof order.createdAt === "string") {
        body.push({
          label: "Date",
          value: new Date(order.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
        });
      }
      topics.push({
        id: "order",
        title: "Order Summary",
        summary: summaryParts.join(" · "),
        body,
      });
    }
  }

  // 2. Payment Verification — from avs_cvv_match payload.
  const avs = payloadFor("avs_cvv_match");
  if (avs) {
    const avsResult = (avs.avsResultCode as string | undefined) ?? null;
    const cvvResult = (avs.cvvResultCode as string | undefined) ?? null;
    const summary = [
      avsResult ? `AVS: ${avsResult}` : null,
      cvvResult ? `CVV: ${cvvResult}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const body: Topic["body"] = [];
    if (avsResult) {
      body.push({
        label: "AVS Result",
        value: avsResult,
        tone: avsResult.toLowerCase() === "match" ? "success" : undefined,
      });
    }
    if (cvvResult) {
      body.push({
        label: "CVV Result",
        value: cvvResult,
        tone: cvvResult.toLowerCase() === "match" ? "success" : undefined,
      });
    }
    if (body.length > 0) {
      topics.push({
        id: "payment",
        title: "Payment Verification",
        summary: summary || "AVS & CVV captured",
        body,
      });
    }
  }

  // 3. Customer Activity — from customer_account_info payload.
  const customer = payloadFor("customer_account_info");
  if (customer) {
    const total =
      typeof customer.totalOrders === "number" ? customer.totalOrders : null;
    const repeat = Boolean(customer.isRepeatCustomer);
    const since =
      typeof customer.customerSince === "string" ? customer.customerSince : null;
    const summaryParts: string[] = [];
    if (total !== null) summaryParts.push(`${total} order${total === 1 ? "" : "s"}`);
    if (repeat) summaryParts.push("repeat customer");
    const body: Topic["body"] = [];
    if (total !== null)
      body.push({ label: "Total orders", value: String(total) });
    body.push({
      label: "Status",
      value: repeat ? "Repeat customer" : total === 1 ? "First-time customer" : "—",
    });
    if (since) {
      body.push({
        label: "Customer since",
        value: new Date(since).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      });
    }
    if (body.length > 0) {
      topics.push({
        id: "customer",
        title: "Customer Activity",
        summary: summaryParts.join(" · ") || "Customer profile captured",
        body,
      });
    }
  }

  // 4. Policies — derived from which policy fields appear in the
  // SubmissionField list, since policy snapshots are submitted as text.
  const policyFields = fields.filter((f) =>
    ["refundPolicy", "shippingPolicy", "cancellationPolicy"].includes(
      f.shopifyFieldName,
    ),
  );
  if (policyFields.length > 0) {
    topics.push({
      id: "policies",
      title: "Policies",
      summary: `${policyFields.length} polic${policyFields.length === 1 ? "y" : "ies"} included`,
      body: policyFields.map((f) => ({
        label: f.shopifyFieldLabel,
        value: f.contentPreview || "Captured at checkout",
        tone: "success" as const,
      })),
    });
  }

  return topics;
}

/* ── Submitted-view sub-components ── */

function SubmissionStatusHero({
  submittedAt,
  shopifyAdminUrl,
}: {
  submittedAt: string | null;
  shopifyAdminUrl: string | null;
}) {
  return (
    <div
      style={{
        background: "#F0FDF4",
        border: "2px solid #86EFAC",
        borderRadius: 8,
        padding: 20,
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 8,
          background: "#D1FAE5",
          color: "#059669",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon source={CheckCircleIcon} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#065F46",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Evidence submitted to Shopify
          </h2>
          <span
            style={{
              ...PILL_STYLE,
              background: "#065F46",
              color: "#ffffff",
            }}
          >
            Submitted
          </span>
        </div>
        {submittedAt && (
          <p
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#065F46",
              opacity: 0.8,
              margin: 0,
              marginBottom: 12,
            }}
          >
            {formatSubmittedTimestamp(submittedAt)}
          </p>
        )}
        {shopifyAdminUrl && (
          <a
            href={shopifyAdminUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "8px 16px",
              background: "#ffffff",
              border: "1px solid #86EFAC",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              color: "#065F46",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            View in Shopify Admin
            <span style={{ width: 16, height: 16, display: "inline-flex" }}>
              <Icon source={ExternalIcon} />
            </span>
          </a>
        )}
      </div>
    </div>
  );
}

function ExactDataSentCard({
  packId,
  fields,
  previewLoading,
  emptyFallback,
}: {
  packId: string;
  fields: SubmissionField[];
  previewLoading: boolean;
  emptyFallback: string;
}) {
  const [view, setView] = useState<"formatted" | "raw">("formatted");
  const [rawPayload, setRawPayload] = useState<unknown | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  const fetchRaw = useCallback(async () => {
    if (rawPayload || rawLoading) return;
    setRawLoading(true);
    setRawError(null);
    try {
      const res = await fetch(
        `/api/packs/${packId}/submission-preview?format=raw`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRawPayload(data.mutationPayload ?? null);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : "Failed to load raw payload");
    } finally {
      setRawLoading(false);
    }
  }, [packId, rawPayload, rawLoading]);

  return (
    <div style={blueOutlinedCard}>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">Exact data sent to Shopify</Text>
        {view === "formatted" ? (
          <BlockStack gap="300">
            {previewLoading ? (
              <Text as="p" variant="bodySm" tone="subdued">Loading…</Text>
            ) : fields.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">{emptyFallback}</Text>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: 12,
                }}
              >
                {fields.map((f) => (
                  <div
                    key={f.shopifyFieldName}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 24,
                      paddingBottom: 8,
                      borderBottom: "1px solid #E1E3E5",
                    }}
                  >
                    <span style={{ color: "#6D7175", fontSize: 14 }}>
                      {submissionFieldHeading(f)}
                    </span>
                    <span
                      style={{
                        color: "#202223",
                        fontSize: 14,
                        fontWeight: 500,
                        textAlign: "right",
                        wordBreak: "break-word",
                      }}
                    >
                      {f.contentPreview || f.content || "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setView("raw");
                void fetchRaw();
              }}
              style={{
                marginTop: 4,
                width: "100%",
                padding: "8px 12px",
                background: "#F6F8FB",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                color: "#005BD3",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              View raw submission (Shopify format)
            </button>
          </BlockStack>
        ) : (
          <BlockStack gap="300">
            {rawLoading ? (
              <Text as="p" variant="bodySm" tone="subdued">Loading raw payload…</Text>
            ) : rawError ? (
              <Banner tone="critical">
                <Text as="p" variant="bodySm">{rawError}</Text>
              </Banner>
            ) : (
              <pre
                style={{
                  background: "#F6F8FB",
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                  padding: 16,
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#202223",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {rawPayload
                  ? JSON.stringify(rawPayload, null, 2)
                  : "No payload returned."}
              </pre>
            )}
            <button
              type="button"
              onClick={() => setView("formatted")}
              style={{
                marginTop: 4,
                width: "100%",
                padding: "8px 12px",
                background: "#F6F8FB",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                color: "#005BD3",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              View formatted data
            </button>
          </BlockStack>
        )}
      </BlockStack>
    </div>
  );
}

function WhatWasSentStructured({ topics }: { topics: Topic[] }) {
  const [openId, setOpenId] = useState<string | null>(topics[0]?.id ?? null);
  if (topics.length === 0) return null;
  return (
    <div style={cardChrome}>
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">What was sent</Text>
        <BlockStack gap="200">
          {topics.map((t) => {
            const isOpen = openId === t.id;
            return (
              <div
                key={t.id}
                style={{
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : t.id)}
                  aria-expanded={isOpen}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: 0,
                    padding: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                      {t.title}
                    </span>
                    <span style={{ fontSize: 12, color: "#6D7175" }}>{t.summary}</span>
                  </span>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      color: "#6D7175",
                      transform: isOpen ? "rotate(180deg)" : "none",
                      transition: "transform 150ms",
                      display: "inline-flex",
                    }}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                </button>
                <Collapsible open={isOpen} id={`topic-${t.id}`}>
                  <div
                    style={{
                      padding: "12px 16px 16px",
                      borderTop: "1px solid #E1E3E5",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {t.body.map((row, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 16,
                          fontSize: 14,
                        }}
                      >
                        <span style={{ color: "#6D7175" }}>{row.label}</span>
                        <span
                          style={{
                            color:
                              row.tone === "success"
                                ? "#059669"
                                : row.tone === "subdued"
                                  ? "#6D7175"
                                  : "#202223",
                            fontWeight: 500,
                            textAlign: "right",
                            wordBreak: "break-word",
                          }}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </Collapsible>
              </div>
            );
          })}
        </BlockStack>
      </BlockStack>
    </div>
  );
}

function FinalStatementCard({ rebuttalText }: { rebuttalText: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rebuttalText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // navigator.clipboard can fail in non-https contexts; ignore silently.
    }
  }, [rebuttalText]);
  return (
    <div style={blueOutlinedCard}>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" wrap={false}>
          <BlockStack gap="050">
            <Text as="h3" variant="headingMd">Final statement submitted to bank</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              This is the official defense argument sent to the card network.
            </Text>
          </BlockStack>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy final statement"
            style={{
              padding: "6px 12px",
              background: "#005BD3",
              border: "1px solid #005BD3",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              color: "#ffffff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            <span style={{ width: 16, height: 16, display: "inline-flex" }}>
              <Icon source={ClipboardIcon} />
            </span>
            {copied ? "Copied" : "Copy"}
          </button>
        </InlineStack>
        <div
          style={{
            background: "#F6F8FB",
            border: "2px solid #E1E3E5",
            borderRadius: 8,
            padding: 20,
            fontSize: 14,
            lineHeight: 1.6,
            color: "#202223",
            whiteSpace: "pre-wrap",
          }}
        >
          {rebuttalText}
        </div>
      </BlockStack>
    </div>
  );
}

function SupportingDocumentsCard({
  attachments,
}: {
  attachments: WorkspaceAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div style={cardChrome}>
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">Supporting documents</Text>
        <BlockStack gap="200">
          {attachments.map((a) => (
            <div
              key={a.id}
              style={{
                background: "#F6F8FB",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  color: "#005BD3",
                  flexShrink: 0,
                  display: "inline-flex",
                }}
              >
                <Icon source={attachmentIconFor(a.mimeType)} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#202223",
                    margin: 0,
                    lineHeight: 1.4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.fileName ?? a.label ?? "Attached file"}
                </p>
                <p
                  style={{
                    fontSize: 12,
                    color: "#6D7175",
                    margin: 0,
                    marginTop: 2,
                    lineHeight: 1.4,
                  }}
                >
                  {`${attachmentTypeLabel(a.mimeType)} · ${formatBytes(a.sizeBytes)} · Included in submission`}
                </p>
              </div>
            </div>
          ))}
        </BlockStack>
      </BlockStack>
    </div>
  );
}

function ImportantDisclaimer() {
  return (
    <div
      style={{
        background: "#FEF3C7",
        border: "1px solid #FDE047",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          color: "#92400E",
          flexShrink: 0,
          marginTop: 2,
          display: "inline-flex",
        }}
      >
        <Icon source={InfoIcon} />
      </span>
      <div style={{ fontSize: 14, color: "#92400E" }}>
        <p style={{ margin: 0, fontWeight: 500, marginBottom: 4 }}>
          Important information
        </p>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Some evidence data (like IP address and device fingerprint) is not
          visible in Shopify Admin but has been submitted to the card network
          for review.
        </p>
      </div>
    </div>
  );
}

/* ── Main component ── */

export default function ReviewSubmitTab({ workspace }: { workspace: Workspace }) {
  const { data, clientState, derived, actions } = workspace;
  const t = useTranslations("review.whatWasSent");

  const [fields, setFields] = useState<SubmissionField[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  const pack = data?.pack ?? null;
  const readiness = derived.readiness;
  const warningCount = derived.warningCount;

  useEffect(() => {
    if (!pack) return;
    setPreviewLoading(true);
    fetch(`/api/packs/${pack.id}/submission-preview`)
      .then((r) => r.json())
      .then((d) => setFields(d.fields ?? []))
      .finally(() => setPreviewLoading(false));
  }, [pack, data?.rebuttalDraft]);

  const handleSubmit = useCallback(() => {
    if (
      derived.caseStrength.overall === "weak" ||
      readiness === "ready_with_warnings" ||
      warningCount > 0
    ) {
      actions.setShowOverrideModal(true);
    } else {
      actions.submitToShopify();
    }
  }, [derived.caseStrength.overall, readiness, warningCount, actions]);

  const handleConfirmOverride = useCallback(() => {
    actions.submitToShopify(overrideReason, overrideNote || undefined);
    setOverrideReason("");
    setOverrideNote("");
  }, [actions, overrideReason, overrideNote]);

  // Derived topic groups for the post-submit "What was sent" card. Memo so
  // we don't recompute on every render; depends only on pack + fields.
  const topics = useMemo(
    () => buildTopics(pack, fields),
    [pack, fields],
  );

  if (!data) return null;

  const { caseStrength, improvement, whyWins, missingItems, submitOverrideGaps } = derived;

  if (!pack) {
    return (
      <div style={cardChrome}>
        <Text as="p" variant="bodyMd" tone="subdued">
          Generate an evidence pack first to review and submit.
        </Text>
      </div>
    );
  }

  // System-failure short-circuit. When the build itself failed, evidence-
  // derived fields are invalid and the pack is NOT submittable.
  if (derived.isFailed) {
    return (
      <Banner tone="critical" title="This pack can’t be submitted">
        <Text as="p" variant="bodyMd">
          The evidence pack build did not complete, so there is nothing to
          submit yet. Retry the build from the Overview tab. If it keeps
          failing, contact support.
        </Text>
      </Banner>
    );
  }

  const isReadOnly = derived.isReadOnly;
  const isSaving = clientState.saving;
  const canSubmit = readiness !== "blocked" && !isReadOnly;
  const isStrong = caseStrength.overall === "strong";
  const isWeak = caseStrength.overall === "weak";

  const readinessPill = readinessPillColors(isReadOnly, readiness, isWeak);
  const strengthPill = strengthPillColors(caseStrength.overall);

  const headline = isReadOnly
    ? "✓ Evidence has been submitted to Shopify"
    : isStrong
      ? "Your case is ready to submit"
      : caseStrength.overall === "moderate"
        ? "Your case is ready, but can be strengthened"
        : "Your case needs more evidence before submitting";

  const shopifyAdminUrl =
    data.dispute.shopDomain && data.dispute.disputeEvidenceGid
      ? getShopifyDisputeUrl(
          data.dispute.shopDomain,
          data.dispute.disputeEvidenceGid,
        )
      : null;

  const rebuttalText = data.rebuttalDraft
    ? data.rebuttalDraft.sections
        .map((s) => s.text)
        .join("\n\n")
        .trim()
    : "";

  const manualUploads = (data.attachments ?? []).filter(
    (a) => a.source === "manual_upload",
  );

  const relevantEvents = pack.auditEvents.filter((e) =>
    [
      "evidence_waived",
      "evidence_unwaived",
      "submitted_with_warnings",
      "evidence_saved_to_shopify",
      "admin_override",
    ].includes(e.event_type),
  );

  /* ── Render ── */

  return (
    <BlockStack gap="500">
      {/* ───────────────────────────────────────────────────────────────
          SUBMITTED VIEW (Figma post-submit composition)
          ─────────────────────────────────────────────────────────────── */}
      {isReadOnly ? (
        <>
          <SubmissionStatusHero
            submittedAt={pack.savedToShopifyAt ?? null}
            shopifyAdminUrl={shopifyAdminUrl}
          />
          <ExactDataSentCard
            packId={pack.id}
            fields={fields}
            previewLoading={previewLoading}
            emptyFallback={t("emptyFallback")}
          />
          <WhatWasSentStructured topics={topics} />
          {rebuttalText && <FinalStatementCard rebuttalText={rebuttalText} />}
          <SupportingDocumentsCard attachments={manualUploads} />
          <ImportantDisclaimer />
          <Text as="p" variant="bodySm" tone="subdued">
            {t("verificationNote")}
          </Text>
        </>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════
              SECTION 1 — DECISION BLOCK (pre-submit, restyled chrome)
              ═══════════════════════════════════════════════════════════ */}
          <div style={cardChrome}>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center" wrap>
                <span
                  style={{
                    ...PILL_STYLE,
                    background: readinessPill.bg,
                    color: readinessPill.color,
                  }}
                >
                  {readinessPill.label}
                </span>
                <span
                  style={{
                    ...PILL_STYLE,
                    background: strengthPill.bg,
                    color: strengthPill.color,
                  }}
                >
                  {`Case strength: ${strengthLabel(caseStrength.overall)}`}
                </span>
              </InlineStack>

              <Text as="h2" variant="headingLg">{headline}</Text>

              {whyWins.strengths.length > 0 && (
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Your defense is supported by:
                  </Text>
                  {whyWins.strengths.map((s) => (
                    <Text
                      key={s.counterclaimId + s.text}
                      as="p"
                      variant="bodySm"
                    >
                      {`• ${s.text}`}
                    </Text>
                  ))}
                </BlockStack>
              )}

              {(missingItems.length > 0 || submitOverrideGaps.length > 0) &&
                (!isStrong || submitOverrideGaps.length > 0) && (
                <BlockStack gap="100">
                  <Text
                    as="p"
                    variant="bodySm"
                    fontWeight="semibold"
                    tone="caution"
                  >
                    {submitOverrideGaps.length > 0
                      ? "Checklist still shows these as missing (you can submit with confirmation):"
                      : "Not included in this submission:"}
                  </Text>
                  {(submitOverrideGaps.length > 0
                    ? submitOverrideGaps
                    : missingItems
                        .slice(0, 6)
                        .map((m) => ({ field: m.field, label: m.label }))
                  ).map((item) => (
                    <Text
                      key={item.field}
                      as="p"
                      variant="bodySm"
                      tone="subdued"
                    >
                      {`• ${item.label}`}
                    </Text>
                  ))}
                </BlockStack>
              )}

              {!isStrong && improvement && (
                <>
                  <Divider />
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {`${improvement.action} to improve your chances of winning`}
                    </Text>
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </div>

          {/* ═══════════════════════════════════════════════════════════
              SECTION 2 — PRIMARY ACTION (pre-submit)
              ═══════════════════════════════════════════════════════════ */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Button
                variant="primary"
                fullWidth
                onClick={handleSubmit}
                disabled={!canSubmit || isSaving}
                loading={isSaving}
                size="large"
              >
                Submit evidence to Shopify
              </Button>
            </div>
            {!isStrong && (
              <div style={{ flex: 1 }}>
                <Button
                  fullWidth
                  size="large"
                  onClick={() => {
                    if (improvement) {
                      actions.navigateToEvidence(improvement.field);
                    } else {
                      actions.setActiveTab(1);
                    }
                  }}
                >
                  Improve case first
                </Button>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════
              SECTION 3 — WHAT WILL BE SUBMITTED (collapsed, pre-submit)
              ═══════════════════════════════════════════════════════════ */}
          <div style={cardChrome}>
            <BlockStack gap="200">
              {data.rebuttalOutdated && (
                <Banner tone="warning" title="Defense letter may be out of date">
                  <BlockStack gap="200">
                    {regenerateError && (
                      <Text as="p" variant="bodySm" tone="critical">
                        {regenerateError}
                      </Text>
                    )}
                    <Text as="p" variant="bodySm">
                      This pack was updated after your last defense letter was
                      generated. Regenerate the argument so the submission
                      preview matches the latest issuer-grade template and pack
                      data.
                    </Text>
                    <Button
                      variant="primary"
                      loading={clientState.regeneratingArgument}
                      disabled={clientState.regeneratingArgument}
                      onClick={() => {
                        setRegenerateError(null);
                        void actions.regenerateArgument().then((result) => {
                          if (!result.ok) setRegenerateError(result.error);
                        });
                      }}
                    >
                      Regenerate defense letter
                    </Button>
                  </BlockStack>
                </Banner>
              )}
              <Button
                variant="plain"
                onClick={() => setDetailsOpen((v) => !v)}
                disclosure={detailsOpen ? "up" : "down"}
              >
                {detailsOpen ? "Hide submission details" : "What will be submitted"}
              </Button>
              <Collapsible open={detailsOpen} id="submission-details">
                <div style={submissionMonoBlockStyle}>
                  {previewLoading ? (
                    <div style={{ color: "#64748b" }}>
                      Loading submission preview…
                    </div>
                  ) : fields.length === 0 ? (
                    <div style={{ color: "#64748b" }}>
                      No evidence fields to submit yet.
                    </div>
                  ) : (
                    fields.map((f, idx) => (
                      <div key={f.shopifyFieldName}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          {submissionFieldHeading(f)}
                        </div>
                        <div>{f.content}</div>
                        {idx < fields.length - 1 && (
                          <div
                            style={{
                              borderTop: "1px solid #d1d5db",
                              margin: "16px 0",
                            }}
                          />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </Collapsible>
            </BlockStack>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════
          ACTIVITY LOG (both views, when relevant)
          ═══════════════════════════════════════════════════════════ */}
      {relevantEvents.length > 0 && (
        <div style={cardChrome}>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
              Activity
            </Text>
            {relevantEvents.slice(0, 5).map((evt) => (
              <Text key={evt.id} as="p" variant="bodySm" tone="subdued">
                {`${new Date(evt.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })} — ${evt.event_type.replace(/_/g, " ")}`}
              </Text>
            ))}
          </BlockStack>
        </div>
      )}

      {/* Override Modal (unchanged) */}
      <Modal
        open={clientState.showOverrideModal}
        onClose={() => actions.setShowOverrideModal(false)}
        title="Submit with current evidence?"
        primaryAction={{
          content: "Submit anyway",
          onAction: handleConfirmOverride,
          destructive: true,
          disabled: !overrideReason,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => actions.setShowOverrideModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  {isWeak
                    ? `This case is rated ${strengthLabel(
                        caseStrength.overall,
                      ).toLowerCase()}${
                        caseStrength.improvementHint
                          ? ` because ${caseStrength.improvementHint}`
                          : ""
                      }. Submitting now may significantly reduce your chances of winning.`
                    : "Your evidence template still marks the items below as missing. They are required for a complete checklist score but are not treated as hard blockers — submitting is allowed after you confirm."}
                </Text>
                {submitOverrideGaps.length > 0 && (
                  <BlockStack gap="100">
                    {isWeak && (
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Missing checklist items:
                      </Text>
                    )}
                    {submitOverrideGaps.map((g) => (
                      <Text key={g.field} as="p" variant="bodySm">
                        {`• ${g.label}`}
                      </Text>
                    ))}
                  </BlockStack>
                )}
                {isWeak && whyWins.weaknesses.length > 0 && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      Why this case is weak:
                    </Text>
                    {whyWins.weaknesses.map((w) => (
                      <Text
                        key={w.counterclaimId + w.text}
                        as="p"
                        variant="bodySm"
                      >
                        {`• ${w.text}`}
                      </Text>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Banner>

            <Select
              label="Why are you submitting now?"
              options={[
                { label: "Select a reason", value: "" },
                { label: "I've provided all available evidence", value: "all_available" },
                { label: "Missing evidence doesn't apply", value: "not_applicable" },
                { label: "Deadline is approaching", value: "deadline" },
                { label: "Other", value: "other" },
              ]}
              value={overrideReason}
              onChange={setOverrideReason}
            />

            {overrideReason === "other" && (
              <TextField
                label="Note"
                value={overrideNote}
                onChange={setOverrideNote}
                autoComplete="off"
                multiline={2}
              />
            )}

            <Text as="p" variant="bodySm" tone="subdued">
              This decision will be logged.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

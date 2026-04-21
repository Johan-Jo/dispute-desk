"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  Collapsible,
  Icon,
  DropZone,
  Spinner,
  Popover,
  ActionList,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  MinusCircleIcon,
} from "@shopify/polaris-icons";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type { EvidenceItemWithStrength, WaiveReason } from "../workspace-components/types";
import styles from "../workspace.module.css";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const WAIVE_REASON_LABELS: Record<WaiveReason, string> = {
  not_applicable: "Not applicable to this dispute",
  evidence_unavailable: "I can\u2019t get this evidence",
  already_in_shopify: "Already submitted separately",
  merchant_accepts_risk: "I understand the risk",
  other: "Other reason",
};

/* Plain-English description for each evidence row, used in both EvidenceTab
 * and OverviewTab (kept in sync via WHY_EVIDENCE_MATTERS). Bank-grade
 * wording — what the row actually proves to the bank, in plain language. */
const WHY_TEXT: Record<string, string> = {
  order_confirmation: "A complete record of the order, including items, amount, and customer details.",
  shipping_tracking: "Carrier confirmation that the order was shipped and delivered.",
  delivery_proof: "Proof of delivery through signature or photographic confirmation.",
  billing_address_match: "Matches the billing address to the order",
  avs_cvv_match: "Card security checks confirming the purchaser had access to billing details.",
  product_description: "Proves the product matched its description",
  refund_policy: "Shows customer agreed to refund terms",
  shipping_policy: "Documents shipping commitments",
  cancellation_policy: "Proves cancellation rules were disclosed",
  customer_communication: "Messages or emails showing engagement before or after the purchase.",
  customer_account_info: "Account age and activity supporting a legitimate customer profile.",
  duplicate_explanation: "Explains why charges are not duplicates",
  supporting_documents: "Additional proof that strengthens your case",
  activity_log: "Evidence of prior successful transactions from the same customer.",
  device_session_consistency: "Technical signals showing consistent device and session behavior.",
  ip_location_check: "Verification of purchase location compared to billing details and prior activity.",
};

/* Plain-language label for each evidence field — used in "How strong your case is".
 * Bank-grade titles per the 2026-04-21 evidence-model rename. */
const FRIENDLY_FIELD_LABEL: Record<string, string> = {
  order_confirmation: "Transaction Record",
  shipping_tracking: "Shipping Confirmation",
  delivery_proof: "Delivery Confirmation (Signature / Photo)",
  billing_address_match: "Billing address match",
  avs_cvv_match: "Payment Verification (AVS & CVV)",
  product_description: "Product listing",
  refund_policy: "Refund policy",
  shipping_policy: "Shipping policy",
  cancellation_policy: "Cancellation policy",
  customer_communication: "Customer Communication",
  customer_account_info: "Customer Account Profile",
  duplicate_explanation: "Duplicate-charge explanation",
  supporting_documents: "Extra supporting documents",
  activity_log: "Customer History",
  device_session_consistency: "Device & Session Consistency",
  ip_location_check: "IP & Location Check",
};

/* Plain-language impact statement for missing evidence. */
const MISSING_IMPACT: Record<string, string> = {
  order_confirmation: "the case loses its anchor — required to prove this was a real transaction.",
  shipping_tracking: "you can\u2019t prove the order left your warehouse.",
  delivery_proof: "you can\u2019t prove the customer received the package — reduces strength for delivery-related disputes.",
  billing_address_match: "the bank can\u2019t verify the cardholder.",
  avs_cvv_match: "the bank has no proof the card security checks passed.",
  product_description: "you can\u2019t prove the product matched what was advertised.",
  refund_policy: "the bank assumes no refund terms were disclosed.",
  shipping_policy: "delivery timing claims are harder to defend.",
  cancellation_policy: "cancellation timing claims are harder to defend.",
  customer_communication: "the bank doesn\u2019t see your engagement with the customer.",
  customer_account_info: "the bank can\u2019t tell whether this is a first-time buyer or an established repeat customer.",
  duplicate_explanation: "the bank assumes the charges are duplicates.",
  activity_log: "the bank can\u2019t see legitimate purchase history.",
  supporting_documents: "the case has fewer corroborating signals.",
  ip_location_check: "no location verification data was available for this order \u2014 this is optional evidence and the case isn\u2019t weaker without it.",
  device_session_consistency: "no device or session signal was available for this order.",
};

function friendlyLabel(field: string, fallback: string): string {
  return FRIENDLY_FIELD_LABEL[field] ?? fallback;
}

function impactSentence(field: string): string {
  const tail = MISSING_IMPACT[field] ?? "the case is weaker than it could be.";
  return `Missing ${friendlyLabel(field, field).toLowerCase()} \u2014 without it, ${tail}`;
}

/* ── Outcome / confidence helpers ── */

function outcomeFromStrength(level: string): { label: string; tone: "success" | "warning" | "critical" } {
  if (level === "strong") return { label: "Likely to win", tone: "success" };
  if (level === "moderate") return { label: "Moderate", tone: "warning" };
  return { label: "Weak", tone: "critical" };
}

function confidenceFrom(level: string, score: number): { label: string; tone: "success" | "warning" | "critical" } {
  if (level === "strong" && score >= 70) return { label: "High", tone: "success" };
  if (level === "weak" || level === "insufficient" || score < 40) return { label: "Low", tone: "critical" };
  return { label: "Medium", tone: "warning" };
}

/* ── Content Preview Renderers ── */

function renderContent(field: string, content: Record<string, unknown> | null): React.ReactNode {
  if (!content) return null;

  // Shipping / Tracking
  if (field === "shipping_tracking" || field === "delivery_proof") {
    const fulfillments = content.fulfillments as Array<Record<string, unknown>> | undefined;
    if (!fulfillments?.length) return <GenericPreview data={content} />;
    return (
      <div className={styles.contentPreview}>
        {fulfillments.map((f, i) => (
          <BlockStack key={i} gap="100">
            {Array.isArray(f.tracking) ? (f.tracking as Array<Record<string, unknown>>).map((t, j) => (
              <div key={j}>
                <Row label="Carrier" value={String(t.carrier ?? "\u2014")} />
                <Row label="Tracking" value={String(t.number ?? "\u2014")} />
              </div>
            )) : null}
            <Row label="Status" value={String(f.displayStatus ?? f.status ?? "\u2014")} />
            {typeof f.deliveredAt === "string" ? <Row label="Delivered" value={formatDate(f.deliveredAt)} /> : null}
            {typeof f.createdAt === "string" ? <Row label="Shipped" value={formatDate(f.createdAt)} /> : null}
          </BlockStack>
        ))}
      </div>
    );
  }

  // AVS / CVV
  if (field === "avs_cvv_match") {
    return (
      <div className={styles.contentPreview}>
        <Row label="AVS" value={String(content.avsResultCode ?? "\u2014")} />
        <Row label="CVV" value={String(content.cvvResultCode ?? "\u2014")} />
        <Row label="Gateway" value={String(content.gateway ?? "\u2014")} />
        {typeof content.lastFour === "string" ? <Row label="Card" value={`****${content.lastFour}`} /> : null}
      </div>
    );
  }

  // Order
  if (field === "order_confirmation") {
    return (
      <div className={styles.contentPreview}>
        <Row label="Order" value={String(content.orderName ?? "\u2014")} />
        <Row label="Created" value={typeof content.createdAt === "string" ? formatDate(content.createdAt) : "\u2014"} />
        {content.totals && typeof content.totals === "object" ? (
          <Row label="Total" value={`${(content.totals as Record<string, unknown>).currency ?? ""} ${(content.totals as Record<string, unknown>).total ?? ""}`} />
        ) : null}
      </div>
    );
  }

  // Policy
  if (field.includes("policy")) {
    const policies = content.policies as Array<Record<string, unknown>> | undefined;
    if (policies?.length) {
      const p = policies[0];
      return (
        <div className={styles.contentPreview}>
          <Row label="Type" value={String(p.policyType ?? "\u2014")} />
          <Row label="Captured" value={typeof p.capturedAt === "string" ? formatDate(p.capturedAt) : "\u2014"} />
          {typeof p.textPreview === "string" ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {p.textPreview.slice(0, 200)}
              {p.textPreview.length > 200 ? "..." : ""}
            </Text>
          ) : null}
        </div>
      );
    }
  }

  // Customer account info
  if (field === "customer_account_info") {
    const total = typeof content.totalOrders === "number" ? content.totalOrders : null;
    const since = typeof content.customerSince === "string" ? content.customerSince : null;
    const repeat = Boolean(content.isRepeatCustomer);
    return (
      <div className={styles.contentPreview}>
        <Row
          label="Status"
          value={repeat ? "Repeat customer" : total === 1 ? "First-time customer" : "\u2014"}
        />
        {total !== null ? <Row label="Total orders" value={String(total)} /> : null}
        {since ? <Row label="Customer since" value={formatDate(since)} /> : null}
      </div>
    );
  }

  // IP & Location Check — interpreted-signal sentences only.
  // Never renders raw IP, org/ASN, or coordinates. Two lines max:
  // primary verdict + optional reliability note.
  if (field === "ip_location_check") {
    const summary = typeof content.summary === "string" ? content.summary : "";
    const merchantGuidance = typeof content.merchantGuidance === "string" ? content.merchantGuidance : null;
    const lines = summary ? summary.split("\n").filter((l) => l.trim().length > 0) : [];

    return (
      <BlockStack gap="200">
        {lines.map((line, i) => (
          <Text key={i} as="p" variant="bodyMd" fontWeight={i === 0 ? "semibold" : "regular"}>
            {line}
          </Text>
        ))}

        {merchantGuidance ? (
          <Banner tone="info">
            <Text as="p" variant="bodySm">{merchantGuidance}</Text>
          </Banner>
        ) : null}
      </BlockStack>
    );
  }

  return <GenericPreview data={content} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.contentPreviewRow}>
      <span className={styles.contentPreviewLabel}>{label}</span>
      <span className={styles.contentPreviewValue}>{value}</span>
    </div>
  );
}

function GenericPreview({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).slice(0, 6);
  if (entries.length === 0) return null;
  return (
    <div className={styles.contentPreview}>
      {entries.map(([k, v]) => (
        <Row key={k} label={k.replace(/_/g, " ")} value={typeof v === "object" ? JSON.stringify(v) : String(v ?? "\u2014")} />
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Merchant-safe copy for system failure codes. The internal
 * failure_reason is never rendered directly — we map the code to
 * controlled wording here and keep the raw text in audit logs only.
 */
const FAILURE_COPY: Record<string, { title: string; body: string }> = {
  order_fetch_failed: {
    title: "We couldn\u2019t retrieve the Shopify order data",
    body:
      "This pack couldn\u2019t be built because we weren\u2019t able to load the underlying order from Shopify. " +
      "This is a system issue on our end \u2014 not missing evidence on yours. " +
      "Try rebuilding. If it keeps failing, contact support and reference this dispute.",
  },
};

const FAILURE_FALLBACK = {
  title: "We couldn\u2019t finish building this pack",
  body:
    "Something went wrong while assembling the evidence pack. " +
    "This is a system issue, not a missing-evidence issue. " +
    "Try rebuilding. If it keeps failing, contact support.",
};

/* ── Evidence Tab ── */

export default function EvidenceTab({ workspace }: { workspace: Workspace }) {
  const { data, clientState, derived, actions } = workspace;
  const [letterOpen, setLetterOpen] = useState(false);

  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Scroll-to-focus
  useEffect(() => {
    if (!clientState.focusField) return;
    const el = itemRefs.current.get(clientState.focusField);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => actions.clearFocus(), 1200);
    return () => clearTimeout(timer);
  }, [clientState.focusField, actions]);

  if (!data) return null;

  // System failure short-circuit. When the build itself failed (e.g.,
  // order fetch from Shopify failed), the rest of this tab — argument
  // map, evidence categories, defense letter — is meaningless. Render
  // a single banner that names the system-level cause and offers a
  // retry. Never tell the merchant they're "missing evidence" when we
  // never finished the build in the first place.
  if (derived.isFailed) {
    const copy = (derived.failureCode && FAILURE_COPY[derived.failureCode]) || FAILURE_FALLBACK;
    return (
      <BlockStack gap="400">
        <Banner tone="critical" title={copy.title}>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">{copy.body}</Text>
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={clientState.loading || clientState.retrying}
                disabled={clientState.retrying}
                onClick={() => { void actions.generatePack(); }}
              >
                Retry build
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
      </BlockStack>
    );
  }

  const { argumentMap, rebuttalDraft } = data;
  const { categories, missingItems, whyWins } = derived;
  const readOnly = derived.isReadOnly;

  const strengthKey = derived.caseStrength.overall;
  const score = derived.caseStrength.score ?? 0;
  const outcome = outcomeFromStrength(strengthKey);
  const confidence = confidenceFrom(strengthKey, score);

  const topGap = missingItems[0];
  const recommendation: string = (() => {
    if (readOnly) {
      return "No further action — your case has been submitted. Wait for the bank\u2019s response.";
    }
    if (strengthKey === "strong") {
      return "Submit as is — your evidence is ready to defend this charge.";
    }
    if (strengthKey === "moderate") {
      return topGap
        ? `Submit as is, or add ${friendlyLabel(topGap.field, topGap.label).toLowerCase()} to lift the case further.`
        : "Submit as is, or add one more piece of evidence to lift the case further.";
    }
    return topGap
      ? `Add ${friendlyLabel(topGap.field, topGap.label).toLowerCase()} before submitting \u2014 the case is unlikely to win as-is.`
      : "Strengthen the evidence before submitting \u2014 the case is unlikely to win as-is.";
  })();

  const summarySection = rebuttalDraft?.sections.find((s) => s.type === "summary");
  const summaryExcerpt = summarySection?.text?.trim() ?? null;

  return (
    <BlockStack gap="400">
      {/* 1. TOP SUMMARY — outcome + confidence + recommendation */}
      <Card>
        <BlockStack gap="400">
          <InlineStack gap="300" blockAlign="center" wrap>
            <BlockStack gap="050">
              <Text as="p" variant="bodySm" tone="subdued">Likely outcome</Text>
              <Badge tone={outcome.tone}>{outcome.label}</Badge>
            </BlockStack>
            <BlockStack gap="050">
              <Text as="p" variant="bodySm" tone="subdued">Confidence</Text>
              <Badge tone={confidence.tone}>{confidence.label}</Badge>
            </BlockStack>
          </InlineStack>

          <BlockStack gap="100">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {`Recommendation: ${recommendation}`}
            </Text>
          </BlockStack>

          {whyWins.strengths.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Key strengths</Text>
              <BlockStack gap="050">
                {whyWins.strengths.slice(0, 3).map((s, i) => (
                  <InlineStack key={i} gap="200" blockAlign="start" wrap={false}>
                    <Text as="span" variant="bodyMd" tone="success">{"\u2713"}</Text>
                    <Text as="p" variant="bodyMd">{s}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          )}

          {missingItems.length > 0 && strengthKey !== "strong" && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">Key gaps</Text>
              <BlockStack gap="050">
                {missingItems.slice(0, 3).map((m) => (
                  <InlineStack key={m.field} gap="200" blockAlign="start" wrap={false}>
                    <Text as="span" variant="bodyMd" tone="critical">{"\u25CB"}</Text>
                    <Text as="p" variant="bodyMd">{impactSentence(m.field)}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* 2. HOW STRONG YOUR CASE IS — was "Argument map" */}
      {argumentMap && (
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">How strong your case is</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {argumentMap.issuerClaim.text}
            </Text>

            {argumentMap.counterclaims.map((claim) => {
              const claimTone =
                claim.strength === "strong" ? "success" :
                claim.strength === "moderate" ? "warning" :
                "critical";
              const claimLabel =
                claim.strength === "strong" ? "Strong" :
                claim.strength === "moderate" ? "Moderate" :
                claim.strength === "weak" ? "Weak" :
                "Needs evidence";

              return (
                <div
                  key={claim.id}
                  className={`${styles.claimCard} ${
                    claim.strength === "strong" ? styles.claimStrong :
                    claim.strength === "moderate" ? styles.claimModerate :
                    claim.strength === "weak" ? styles.claimWeak :
                    styles.claimInsufficient
                  }`}
                >
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{claim.title}</Text>
                      <Badge tone={claimTone}>{claimLabel}</Badge>
                    </InlineStack>

                    {claim.supporting.length > 0 && (
                      <InlineStack gap="200" wrap>
                        {claim.supporting.map((s) => (
                          <span
                            key={s.field}
                            className={`${styles.evidenceTag} ${s.status === "available" ? styles.evidenceTagAvailable : styles.evidenceTagWaived}`}
                            onClick={() => actions.navigateToEvidence(s.field)}
                          >
                            {s.status === "available" ? "\u2713" : "\u2014"} {friendlyLabel(s.field, s.label)}
                          </span>
                        ))}
                      </InlineStack>
                    )}

                    {claim.missing.length > 0 && (
                      <BlockStack gap="100">
                        {claim.missing.map((m) => (
                          <InlineStack key={m.field} gap="200" blockAlign="start" wrap={false}>
                            <Text as="span" variant="bodySm" tone="critical">{"\u25CB"}</Text>
                            <BlockStack gap="050">
                              <Text as="p" variant="bodySm">{impactSentence(m.field)}</Text>
                              {!readOnly && (
                                <span
                                  className={`${styles.evidenceTag} ${styles.evidenceTagMissing}`}
                                  onClick={() => actions.navigateToEvidence(m.field)}
                                >
                                  Add {friendlyLabel(m.field, m.label).toLowerCase()}
                                </span>
                              )}
                            </BlockStack>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </div>
              );
            })}
          </BlockStack>
        </Card>
      )}

      {/* 3. DEFENSE LETTER — collapsed by default */}
      {rebuttalDraft && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="h3" variant="headingMd">Defense letter</Text>
              <Button
                variant="plain"
                ariaExpanded={letterOpen}
                ariaControls="defense-letter-full"
                disclosure={letterOpen ? "up" : "down"}
                onClick={() => setLetterOpen((v) => !v)}
              >
                {letterOpen ? "Hide full defense letter" : "View full defense letter"}
              </Button>
            </InlineStack>

            {summaryExcerpt && !letterOpen && (
              <Text as="p" variant="bodyMd" tone="subdued">
                {summaryExcerpt.length > 220 ? `${summaryExcerpt.slice(0, 220).trim()}\u2026` : summaryExcerpt}
              </Text>
            )}

            <Collapsible
              open={letterOpen}
              id="defense-letter-full"
              transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
              expandOnPrint
            >
              <BlockStack gap="300">
                {rebuttalDraft.sections.map((section) => (
                  <BlockStack key={section.id} gap="100">
                    <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                      {section.type === "summary" ? "Summary" :
                       section.type === "conclusion" ? "Conclusion" :
                       argumentMap?.counterclaims.find((c) => c.id === section.claimId)?.title ?? "Argument"}
                    </Text>
                    <Text as="p" variant="bodyMd">{section.text}</Text>
                    {section.evidenceRefs.length > 0 && (
                      <InlineStack gap="100" wrap>
                        {Array.from(new Set(section.evidenceRefs)).map((ref) => (
                          <span
                            key={ref}
                            className={`${styles.evidenceTag} ${styles.evidenceTagAvailable}`}
                            onClick={() => actions.navigateToEvidence(ref)}
                          >
                            {friendlyLabel(ref, ref.replace(/_/g, " "))}
                          </span>
                        ))}
                      </InlineStack>
                    )}
                  </BlockStack>
                ))}
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </Card>
      )}

      {/* 4. EVIDENCE CATEGORIES — proof, unchanged */}
      {categories.map((cat) => (
        <EvidenceCategorySection
          key={cat.category.key}
          category={cat.category}
          items={cat.items}
          relevance={cat.relevance}
          expanded={clientState.expandedCategories.has(cat.category.key)}
          onToggle={() => {
            const next = new Set(clientState.expandedCategories);
            if (next.has(cat.category.key)) next.delete(cat.category.key);
            else next.add(cat.category.key);
            actions.navigateToEvidence(cat.items[0]?.field ?? cat.category.fields[0]);
          }}
          focusField={clientState.focusField}
          uploadingField={clientState.uploadingField}
          failedFields={clientState.failedFields}
          onUpload={actions.uploadEvidence}
          onWaive={actions.waiveItem}
          onUnwaive={actions.unwaiveItem}
          readOnly={readOnly}
          itemRefs={itemRefs}
        />
      ))}

    </BlockStack>
  );
}

/* ── Evidence Category Section ── */

function EvidenceCategorySection({
  category,
  items,
  relevance,
  expanded,
  onToggle,
  focusField,
  uploadingField,
  failedFields,
  onUpload,
  onWaive,
  onUnwaive,
  readOnly,
  itemRefs,
}: {
  category: { key: string; label: string };
  items: EvidenceItemWithStrength[];
  relevance: "high" | "medium" | "low";
  expanded: boolean;
  onToggle: () => void;
  focusField: string | null;
  uploadingField: string | null;
  failedFields: Map<string, string>;
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
  onUnwaive: (field: string) => void;
  readOnly: boolean;
  itemRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}) {
  const availableCount = items.filter((i) => i.status === "available" || i.status === "waived").length;

  return (
    <Card>
      <BlockStack gap="200">
        <div className={styles.categoryHeader} onClick={onToggle}>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingMd">{category.label}</Text>
              <Badge>{`${availableCount}/${items.length}`}</Badge>
              <Badge tone={relevance === "high" ? "success" : relevance === "medium" ? "attention" : undefined}>
                {`${relevance} relevance`}
              </Badge>
            </InlineStack>
            <Icon source={expanded ? ChevronUpIcon : ChevronDownIcon} />
          </InlineStack>
        </div>

        <Collapsible open={expanded} id={`cat-${category.key}`}>
          <BlockStack gap="200">
            {items.map((item) => (
              <EvidenceItemInline
                key={item.field}
                item={item}
                focusField={focusField}
                uploading={uploadingField === item.field}
                error={failedFields.get(item.field)}
                onUpload={onUpload}
                onWaive={onWaive}
                onUnwaive={onUnwaive}
                readOnly={readOnly}
                refCallback={(el) => {
                  if (el) itemRefs.current.set(item.field, el);
                  else itemRefs.current.delete(item.field);
                }}
              />
            ))}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}

/* ── Evidence Item Inline ── */

function EvidenceItemInline({
  item,
  focusField,
  uploading,
  error,
  onUpload,
  onWaive,
  onUnwaive,
  readOnly,
  refCallback,
}: {
  item: EvidenceItemWithStrength;
  focusField: string | null;
  uploading: boolean;
  error?: string;
  onUpload: (field: string, files: File[]) => Promise<void>;
  onWaive: (field: string, reason: WaiveReason) => void;
  onUnwaive: (field: string) => void;
  readOnly: boolean;
  refCallback: (el: HTMLDivElement | null) => void;
}) {
  const [showUpload, setShowUpload] = useState(focusField === item.field);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [showContent, setShowContent] = useState(false);

  const highlighted = focusField === item.field;

  const isSystemDerived = item.collectionType === "auto" || item.collectionType === "conditional_auto";
  const rowClass =
    item.status === "available" ? styles.evidenceRowAvailable :
    item.status === "waived" ? styles.evidenceRowAvailable :
    item.status === "unavailable" ? styles.evidenceRowAvailable :
    isSystemDerived ? styles.evidenceRowAvailable :
    item.priority === "critical" ? styles.evidenceRowMissing :
    styles.evidenceRowMissingRecommended;

  const handleDrop = useCallback(
    async (_files: File[], accepted: File[]) => {
      if (accepted.length === 0) return;
      setShowUpload(false);
      await onUpload(item.field, accepted);
    },
    [item.field, onUpload],
  );

  const waiveActions = Object.entries(WAIVE_REASON_LABELS).map(([reason, label]) => ({
    content: label,
    onAction: () => { setWaiveOpen(false); onWaive(item.field, reason as WaiveReason); },
  }));

  return (
    <div ref={refCallback} className={`${rowClass} ${highlighted ? styles.highlighted : ""}`}>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" wrap>
          <InlineStack gap="200" blockAlign="center" wrap>
            <Icon
              source={
                item.status === "available" ? CheckCircleIcon :
                item.status === "waived" ? MinusCircleIcon :
                (item.collectionType === "auto" || item.collectionType === "conditional_auto")
                  ? MinusCircleIcon :
                item.priority === "critical" ? AlertTriangleIcon :
                AlertTriangleIcon
              }
              tone={
                item.status === "available" ? "success" :
                item.status === "waived" ? "subdued" :
                (item.collectionType === "auto" || item.collectionType === "conditional_auto")
                  ? "subdued" :
                "caution"
              }
            />
            <Text as="span" variant="bodyMd" fontWeight="semibold">{item.label}</Text>
            <Badge tone={
              item.status === "available" ? "success" :
              item.status === "waived" ? undefined :
              item.status === "unavailable" ? undefined :
              (item.collectionType === "auto" || item.collectionType === "conditional_auto")
                ? undefined :
              item.priority === "critical" ? "attention" :
              "attention"
            }>
              {item.status === "available" ? "Available" :
               item.status === "waived" ? "Waived" :
               item.status === "unavailable" ? "Not available" :
               (item.collectionType === "auto" || item.collectionType === "conditional_auto")
                 ? "Not available" :
               item.priority === "critical" ? "Add to strengthen" :
               "Recommended"}
            </Badge>
            {item.strength !== "none" && item.status === "available" && (
              <Badge tone={item.strength === "strong" ? "success" : item.strength === "moderate" ? "warning" : "critical"}>
                {item.strength}
              </Badge>
            )}
          </InlineStack>

          <InlineStack gap="200">
            {item.content && (
              <Button size="slim" variant="plain" onClick={() => setShowContent((v) => !v)}>
                {showContent ? "Hide" : "Preview"}
              </Button>
            )}
            {item.status === "missing" && !readOnly && !uploading && (item.collectionType === "manual" || !item.collectionType) && (
              <>
                <Button size="slim" onClick={() => setShowUpload((v) => !v)}>
                  {error ? "Retry" : "Upload"}
                </Button>
                <Popover
                  active={waiveOpen}
                  activator={
                    <Button size="slim" variant="plain" onClick={() => setWaiveOpen((v) => !v)}>
                      Skip
                    </Button>
                  }
                  onClose={() => setWaiveOpen(false)}
                >
                  <ActionList items={waiveActions} />
                </Popover>
              </>
            )}
            {item.status === "waived" && !readOnly && (
              <Button size="slim" variant="plain" onClick={() => onUnwaive(item.field)}>
                Undo
              </Button>
            )}
            {uploading && <Spinner size="small" />}
          </InlineStack>
        </InlineStack>

        <Text as="p" variant="bodySm" tone="subdued">
          {WHY_TEXT[item.field] ?? "Strengthens your dispute response"}
        </Text>

        {error && (
          <Banner tone="critical" hideIcon>
            <Text as="p" variant="bodySm">{error}</Text>
          </Banner>
        )}

        {/* Content preview */}
        {showContent && item.content && (
          <Collapsible open={showContent} id={`content-${item.field}`}>
            {renderContent(item.field, item.content)}
          </Collapsible>
        )}

        {/* Upload zone */}
        {showUpload && !readOnly && item.status === "missing" && (
          <Collapsible open={showUpload} id={`upload-${item.field}`}>
            <DropZone
              onDrop={handleDrop}
              allowMultiple={false}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
              variableHeight
            >
              <DropZone.FileUpload actionHint="Drop a file or click to upload" />
            </DropZone>
          </Collapsible>
        )}
      </BlockStack>
    </div>
  );
}

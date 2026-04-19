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
  Divider,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CheckCircleIcon,
  XCircleIcon,
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

const WHY_TEXT: Record<string, string> = {
  order_confirmation: "Proves the transaction is legitimate",
  shipping_tracking: "Shows the carrier confirmed shipment",
  delivery_proof: "Confirms the customer received the package",
  billing_address_match: "Matches the billing address to the order",
  avs_cvv_match: "Shows card security checks passed",
  product_description: "Proves the product matched its description",
  refund_policy: "Shows customer agreed to refund terms",
  shipping_policy: "Documents shipping commitments",
  cancellation_policy: "Proves cancellation rules were disclosed",
  customer_communication: "Shows merchant attempted to resolve the issue",
  duplicate_explanation: "Explains why charges are not duplicates",
  supporting_documents: "Additional proof that strengthens your case",
  activity_log: "Customer purchase history and account activity",
};

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

/* ── Evidence Tab ── */

export default function EvidenceTab({ workspace }: { workspace: Workspace }) {
  const { data, clientState, derived, actions } = workspace;

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

  const { argumentMap, rebuttalDraft } = data;
  const { categories, missingItems, effectiveChecklist, whyWins } = derived;
  const readOnly = derived.isReadOnly;

  return (
    <BlockStack gap="400">
      {/* A. Argument Section */}
      {argumentMap && (
        <>
          {/* Argument Summary */}
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">Argument summary</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {argumentMap.issuerClaim.text}
              </Text>
            </BlockStack>
          </Card>

          {/* Argument Map */}
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Argument map</Text>
              {argumentMap.counterclaims.map((claim) => (
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
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {claim.title}
                      </Text>
                      <Badge
                        tone={
                          claim.strength === "strong" ? "success" :
                          claim.strength === "moderate" ? "warning" :
                          "critical"
                        }
                      >
                        {claim.strength.charAt(0).toUpperCase() + claim.strength.slice(1)}
                      </Badge>
                    </InlineStack>

                    {claim.supporting.length > 0 && (
                      <InlineStack gap="200" wrap>
                        {claim.supporting.map((s) => (
                          <span
                            key={s.field}
                            className={`${styles.evidenceTag} ${s.status === "available" ? styles.evidenceTagAvailable : styles.evidenceTagWaived}`}
                            onClick={() => actions.navigateToEvidence(s.field)}
                          >
                            {s.status === "available" ? "\u2713" : "\u2014"} {s.label}
                          </span>
                        ))}
                      </InlineStack>
                    )}

                    {/* System-derived evidence: not available, informational only */}
                    {claim.systemUnavailable && claim.systemUnavailable.length > 0 && (
                      <InlineStack gap="200" wrap>
                        {claim.systemUnavailable.map((s) => (
                          <span
                            key={s.field}
                            className={`${styles.evidenceTag} ${styles.evidenceTagWaived}`}
                          >
                            {s.label}: Not available
                          </span>
                        ))}
                      </InlineStack>
                    )}

                    {/* Merchant-actionable: can be added */}
                    {claim.missing.length > 0 && (
                      <InlineStack gap="200" wrap>
                        {claim.missing.map((m) => (
                          <span
                            key={m.field}
                            className={`${styles.evidenceTag} ${styles.evidenceTagMissing}`}
                            onClick={() => actions.navigateToEvidence(m.field)}
                          >
                            Add {m.label}
                          </span>
                        ))}
                      </InlineStack>
                    )}
                  </BlockStack>
                </div>
              ))}
            </BlockStack>
          </Card>
        </>
      )}

      {/* B. Case Strength — unified decision block */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">Case strength</Text>
            <Badge tone={
              derived.caseStrength.overall === "strong" ? "success" :
              derived.caseStrength.overall === "moderate" ? "warning" :
              "critical"
            }>
              {derived.caseStrength.overall === "strong" ? "Strong" :
               derived.caseStrength.overall === "moderate" ? "Medium" :
               "Weak"}
            </Badge>
          </InlineStack>

          {derived.caseStrength.strengthReason && (
            <Text as="p" variant="bodySm" tone="subdued">
              {derived.caseStrength.strengthReason}
            </Text>
          )}

          {whyWins.strengths.length > 0 && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Your core defense is supported by:
              </Text>
              {whyWins.strengths.map((s, i) => (
                <Text key={i} as="p" variant="bodySm">{`\u2022 ${s}`}</Text>
              ))}
            </BlockStack>
          )}

          {derived.missingItems.length > 0 && derived.caseStrength.overall !== "strong" && (
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                To strengthen your case:
              </Text>
              {derived.missingItems.slice(0, 3).map((item) => (
                <InlineStack key={item.field} gap="200" blockAlign="center">
                  <Text as="p" variant="bodySm">
                    {`\u2022 Add ${item.label}`}
                  </Text>
                  <Badge tone={item.priority === "critical" ? "attention" : undefined}>
                    {item.priority === "critical" ? "critical" : "recommended"}
                  </Badge>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </Card>

      {/* C. Rebuttal Editor */}
      {rebuttalDraft && (
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingMd">Rebuttal letter</Text>
            {rebuttalDraft.sections.map((section) => (
              <BlockStack key={section.id} gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                  {section.type === "summary" ? "Summary" :
                   section.type === "conclusion" ? "Conclusion" :
                   argumentMap?.counterclaims.find((c) => c.id === section.claimId)?.title ?? "Argument"}
                </Text>
                <Text as="p" variant="bodyMd">
                  {section.text}
                </Text>
                {section.evidenceRefs.length > 0 && (
                  <InlineStack gap="100" wrap>
                    {Array.from(new Set(section.evidenceRefs)).map((ref) => (
                      <span
                        key={ref}
                        className={`${styles.evidenceTag} ${styles.evidenceTagAvailable}`}
                        onClick={() => actions.navigateToEvidence(ref)}
                      >
                        {ref.replace(/_/g, " ")}
                      </span>
                    ))}
                  </InlineStack>
                )}
              </BlockStack>
            ))}
          </BlockStack>
        </Card>
      )}

      {/* D. Evidence Categories */}
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
            // Direct state manipulation through the hook would be cleaner,
            // but for now toggle is done via navigateToEvidence side effect
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

      {/* E. Ways to strengthen this case */}
      {!readOnly && (
        <BlockStack gap="400">
          {/* A. Add now — merchant-actionable items */}
          {missingItems.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">Ways to strengthen this case</Text>
                {missingItems.map((item) => (
                  <div key={item.field} className={styles.missingItem}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {item.label}
                        </Text>
                        <Badge tone={item.priority === "critical" ? "attention" : undefined}>
                          {item.priority === "critical" ? "High impact" : "Recommended"}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">{item.impact}</Text>
                      <InlineStack gap="200" wrap>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Format: ${item.acceptedFormats}`}
                        </Text>
                      </InlineStack>
                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          onClick={() => actions.navigateToEvidence(item.field)}
                        >
                          {item.ctaLabel}
                        </Button>
                        <Button
                          size="slim"
                          variant="plain"
                          onClick={() => actions.waiveItem(item.field, "evidence_unavailable")}
                        >
                          {item.skipLabel}
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </div>
                ))}
              </BlockStack>
            </Card>
          )}

          {/* B. Added automatically — system-derived evidence status */}
          {(() => {
            const systemItems = effectiveChecklist.filter(
              (c) => (c.collectionType === "auto" || c.collectionType === "conditional_auto"),
            );
            if (systemItems.length === 0) return null;
            return (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd" tone="subdued">Collected automatically</Text>
                  {systemItems.map((item) => (
                    <div key={item.field} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" }}>
                      <div style={{ flexShrink: 0 }}>
                        <Icon
                          source={item.status === "available" ? CheckCircleIcon : MinusCircleIcon}
                          tone={item.status === "available" ? "success" : "subdued"}
                        />
                      </div>
                      <Text as="span" variant="bodyMd" breakWord={false}>
                        {item.label}
                      </Text>
                      <div style={{ marginLeft: "auto", flexShrink: 0 }}>
                        <Badge tone={item.status === "available" ? "success" : undefined}>
                          {item.status === "available" ? "Available" : "Not available"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </Card>
            );
          })()}
        </BlockStack>
      )}
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
            {/* Only show Upload/Skip for merchant-actionable items (manual collectionType) */}
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

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Collapsible,
  Icon,
  Tabs,
  Divider,
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon, AlertTriangleIcon, CheckCircleIcon } from "@shopify/polaris-icons";
import {
  EvidenceItemRow,
  WaivedItemRow,
  IncludedItemRow,
  type ChecklistItemUI,
} from "./EvidenceItemRow";
import {
  EvidenceContentViewer,
  type EvidenceItemFull,
} from "./EvidenceContentViewer";
import type {
  ChecklistItemV2,
  WaiveReason,
} from "@/lib/types/evidenceItem";
import styles from "@/app/(embedded)/app/packs/[packId]/pack-detail.module.css";

/** Priority order for required evidence fields (highest impact first). */
const FIELD_PRIORITY: Record<string, number> = {
  delivery_proof: 0,
  shipping_tracking: 1,
  avs_cvv_match: 2,
  billing_address_match: 3,
  risk_analysis: 4,
  customer_ip: 5,
  customer_communication: 6,
  refund_policy: 7,
  shipping_policy: 8,
  cancellation_policy: 9,
  product_description: 10,
  order_confirmation: 11,
  duplicate_explanation: 12,
  supporting_documents: 99,
};

function sortByPriority(items: ChecklistItemV2[]): ChecklistItemV2[] {
  return [...items].sort(
    (a, b) =>
      (FIELD_PRIORITY[a.field] ?? 50) - (FIELD_PRIORITY[b.field] ?? 50),
  );
}

/** Outcome-driven "why" text per evidence field. */
const WHY_TEXT: Record<string, string> = {
  order_confirmation:
    "Proves the transaction is legitimate \u2014 the foundation of every dispute response",
  shipping_tracking:
    "Shows the carrier confirmed shipment \u2014 required to win \u2018item not received\u2019 disputes",
  delivery_proof:
    "Confirms the customer received the package \u2014 strongest evidence against \u2018not received\u2019 claims",
  billing_address_match:
    "Matches the billing address to the order \u2014 critical for fraud disputes",
  avs_cvv_match:
    "Shows the card security checks passed \u2014 banks weigh this heavily in fraud cases",
  risk_analysis:
    "Shopify\u2019s fraud assessment for this order \u2014 supports your case when risk was flagged low",
  customer_ip:
    "The IP address used at checkout \u2014 helps prove the purchase came from the cardholder",
  product_description:
    "Proves the product matched what was advertised \u2014 key defense for \u2018not as described\u2019 disputes",
  refund_policy:
    "Shows the customer agreed to your refund terms \u2014 protects against buyer\u2019s remorse claims",
  shipping_policy:
    "Documents your shipping commitments \u2014 supports delivery timeline disputes",
  cancellation_policy:
    "Proves the customer was informed of cancellation rules before purchase",
  customer_communication:
    "Shows you attempted to resolve the issue \u2014 banks favor merchants who engage",
  duplicate_explanation:
    "Explains why the charges are not duplicates \u2014 required for duplicate dispute responses",
  supporting_documents: "Additional proof that strengthens your case",
  activity_log: "Account activity that proves legitimate customer engagement",
};

function getWhyText(field: string): string {
  return WHY_TEXT[field] ?? "Strengthens your dispute response";
}

interface IncludedItem {
  label: string;
  sourceLabel: string;
  timestamp?: string;
  canReplace: boolean;
  field?: string;
}

interface EvidenceBuilderSectionProps {
  /** V2 checklist — sections are derived internally. */
  checklist: ChecklistItemV2[];
  /** Already-included items (from evidence_items + optimistic). */
  includedItems: IncludedItem[];
  /** Full evidence items from the API — used to render content in tabs. */
  evidenceItems?: EvidenceItemFull[];
  onUpload: (field: string, files: File[]) => Promise<void>;
  uploadingField: string | null;
  failedFields: Map<string, string>;
  onReplace?: (field: string, files: File[]) => Promise<void>;
  replacingField: string | null;
  onWaive?: (field: string, reason: WaiveReason) => void;
  onUnwaive?: (field: string) => void;
  /** Field to auto-focus (scroll + expand uploader). */
  focusField: string | null;
  onFocusHandled: () => void;
  readOnly?: boolean;
}

export function EvidenceBuilderSection({
  checklist,
  includedItems,
  evidenceItems = [],
  onUpload,
  uploadingField,
  failedFields,
  onReplace,
  replacingField,
  onWaive,
  onUnwaive,
  focusField,
  onFocusHandled,
  readOnly = false,
}: EvidenceBuilderSectionProps) {
  const [includedOpen, setIncludedOpen] = useState(readOnly);
  const [selectedTab, setSelectedTab] = useState(0);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setItemRef = useCallback(
    (field: string) => (el: HTMLDivElement | null) => {
      if (el) itemRefs.current.set(field, el);
      else itemRefs.current.delete(field);
    },
    [],
  );

  // Scroll-to-focus when header CTA sets focusField
  useEffect(() => {
    if (!focusField) return;
    const el = itemRefs.current.get(focusField);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = setTimeout(() => onFocusHandled(), 1200);
    return () => clearTimeout(timer);
  }, [focusField, onFocusHandled]);

  // Derive 6 sections from checklist
  const blockers = sortByPriority(
    checklist.filter((c) => c.blocking && c.status === "missing"),
  );
  const highImpact = sortByPriority(
    checklist.filter(
      (c) => c.priority === "critical" && !c.blocking && c.status === "missing",
    ),
  );
  const recommended = sortByPriority(
    checklist.filter(
      (c) => c.priority !== "critical" && c.status === "missing",
    ),
  );
  const unavailable = checklist.filter((c) => c.status === "unavailable");
  const waived = checklist.filter((c) => c.status === "waived");

  const hasBlockers = blockers.length > 0;
  const hasHighImpact = highImpact.length > 0;
  const hasRecommended = recommended.length > 0;
  const hasUnavailable = unavailable.length > 0;
  const hasWaived = waived.length > 0;
  const hasIncluded = includedItems.length > 0;

  const isEmpty =
    !hasBlockers && !hasHighImpact && !hasRecommended &&
    !hasUnavailable && !hasWaived && !hasIncluded;

  if (isEmpty) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" tone="subdued">
            No evidence items for this pack.
          </Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      {/* A. Submission Blockers (blocking: true + missing) */}
      {hasBlockers && (
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                Submission blockers
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Complete these items to unblock submission
              </Text>
            </BlockStack>
            {blockers.map((item) => (
              <EvidenceItemRow
                key={item.field}
                ref={setItemRef(item.field)}
                item={item}
                whyText={getWhyText(item.field)}
                onUpload={onUpload}
                isUploading={uploadingField === item.field}
                errorMessage={failedFields.get(item.field)}
                autoExpand={focusField === item.field}
                highlighted={focusField === item.field}
                readOnly={readOnly}
                onWaive={onWaive}
              />
            ))}
          </BlockStack>
        </Card>
      )}

      {/* B. High-Impact Evidence (critical + non-blocking + missing) */}
      {hasHighImpact && (
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                High-impact evidence
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {"These items are likely to improve this case. You can continue without them."}
              </Text>
            </BlockStack>
            {highImpact.map((item) => (
              <EvidenceItemRow
                key={item.field}
                ref={setItemRef(item.field)}
                item={item}
                whyText={getWhyText(item.field)}
                onUpload={onUpload}
                isUploading={uploadingField === item.field}
                errorMessage={failedFields.get(item.field)}
                autoExpand={focusField === item.field}
                highlighted={focusField === item.field}
                readOnly={readOnly}
                onWaive={onWaive}
              />
            ))}
          </BlockStack>
        </Card>
      )}

      {/* C. Recommended Evidence */}
      {hasRecommended && (
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                Recommended evidence
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {"Optional \u2014 improves your chances"}
              </Text>
            </BlockStack>
            {recommended.map((item) => (
              <EvidenceItemRow
                key={item.field}
                ref={setItemRef(item.field)}
                item={item}
                whyText={getWhyText(item.field)}
                onUpload={onUpload}
                isUploading={uploadingField === item.field}
                errorMessage={failedFields.get(item.field)}
                autoExpand={focusField === item.field}
                highlighted={focusField === item.field}
                readOnly={readOnly}
                onWaive={onWaive}
              />
            ))}
          </BlockStack>
        </Card>
      )}

      {/* D. Unavailable Evidence */}
      {hasUnavailable && (
        <Card>
          <BlockStack gap="200">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd" tone="subdued">
                Not available for this order
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {"These items don\u2019t apply or aren\u2019t accessible for this order \u2014 they won\u2019t affect your score"}
              </Text>
            </BlockStack>
            {unavailable.map((item) => (
              <div key={item.field} className={styles.evidenceRowIncluded}>
                <BlockStack gap="050">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Icon source={AlertTriangleIcon} tone="subdued" />
                    <Text as="span" variant="bodyMd" tone="subdued">
                      {item.label}
                    </Text>
                  </InlineStack>
                  {item.unavailableReason && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.unavailableReason}
                    </Text>
                  )}
                </BlockStack>
              </div>
            ))}
          </BlockStack>
        </Card>
      )}

      {/* E. Waived Items */}
      {hasWaived && (
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd" tone="subdued">
              Waived items
            </Text>
            {waived.map((item) => (
              <WaivedItemRow
                key={item.field}
                item={item}
                onUnwaive={readOnly ? undefined : onUnwaive}
              />
            ))}
          </BlockStack>
        </Card>
      )}

      {/* F. Already Included — tabbed view */}
      {hasIncluded && (
        <Card>
          <BlockStack gap="200">
            <Button
              variant="plain"
              onClick={() => setIncludedOpen((v) => !v)}
              icon={includedOpen ? ChevronUpIcon : ChevronDownIcon}
              disclosure={includedOpen ? "up" : "down"}
            >
              {`Already included in your submission (${includedItems.length} ${includedItems.length === 1 ? "item" : "items"})`}
            </Button>

            <Collapsible open={includedOpen} id="already-included">
              {evidenceItems.length > 0 ? (
                <BlockStack gap="0">
                  <Tabs
                    tabs={evidenceItems.map((ei, idx) => ({
                      id: ei.id || `tab-${idx}`,
                      content: ei.label,
                      accessibilityLabel: ei.label,
                    }))}
                    selected={selectedTab}
                    onSelect={(idx) => setSelectedTab(idx)}
                    fitted={evidenceItems.length <= 4}
                  />
                  {evidenceItems[selectedTab] && (
                    <div style={{ padding: "16px 0 8px" }}>
                      <BlockStack gap="300">
                        {/* Source badge */}
                        <InlineStack gap="200" blockAlign="center">
                          <Icon source={CheckCircleIcon} tone="success" />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {includedItems.find(
                              (ii) => ii.field === evidenceItems[selectedTab].type,
                            )?.sourceLabel ?? evidenceItems[selectedTab].source}
                          </Text>
                        </InlineStack>

                        <Divider />

                        {/* Evidence content */}
                        <EvidenceContentViewer item={evidenceItems[selectedTab]} />

                        {/* Replace button for manual uploads */}
                        {(() => {
                          const ei = evidenceItems[selectedTab];
                          const included = includedItems.find((ii) => ii.field === ei.type);
                          if (!included?.canReplace || readOnly) return null;
                          return (
                            <>
                              <Divider />
                              <IncludedItemRow
                                label={ei.label}
                                sourceLabel={included.sourceLabel}
                                timestamp={included.timestamp}
                                canReplace={!readOnly}
                                onReplace={
                                  onReplace
                                    ? (files) => onReplace(ei.type, files)
                                    : undefined
                                }
                                isReplacing={replacingField === ei.type}
                              />
                            </>
                          );
                        })()}
                      </BlockStack>
                    </div>
                  )}
                </BlockStack>
              ) : (
                /* Fallback: no full evidence data, show simple list */
                <BlockStack gap="0">
                  {includedItems.map((item, idx) => (
                    <IncludedItemRow
                      key={item.field ?? `inc-${idx}`}
                      label={item.label}
                      sourceLabel={item.sourceLabel}
                      timestamp={item.timestamp}
                      canReplace={item.canReplace && !readOnly}
                      onReplace={
                        item.field && onReplace
                          ? (files) => onReplace(item.field!, files)
                          : undefined
                      }
                      isReplacing={replacingField === item.field}
                    />
                  ))}
                </BlockStack>
              )}
            </Collapsible>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

// Re-export for backward compat
export type { ChecklistItemUI, IncludedItem };

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
} from "@shopify/polaris";
import { ChevronDownIcon, ChevronUpIcon, AlertTriangleIcon } from "@shopify/polaris-icons";
import {
  EvidenceItemRow,
  IncludedItemRow,
  type ChecklistItemUI,
} from "./EvidenceItemRow";

/** Priority order for required evidence fields (highest impact first). */
const FIELD_PRIORITY: Record<string, number> = {
  delivery_proof: 0,
  shipping_tracking: 1,
  avs_cvv_match: 2,
  billing_address_match: 3,
  customer_communication: 4,
  refund_policy: 5,
  shipping_policy: 6,
  cancellation_policy: 7,
  product_description: 8,
  order_confirmation: 9,
  duplicate_explanation: 10,
  supporting_documents: 99,
};

function sortByPriority(items: ChecklistItemUI[]): ChecklistItemUI[] {
  return [...items].sort(
    (a, b) =>
      (FIELD_PRIORITY[a.field] ?? 50) - (FIELD_PRIORITY[b.field] ?? 50),
  );
}

/** Outcome-driven "why" text per evidence field. */
const WHY_TEXT: Record<string, string> = {
  order_confirmation:
    "Proves the transaction is legitimate — the foundation of every dispute response",
  shipping_tracking:
    "Shows the carrier confirmed shipment — required to win 'item not received' disputes",
  delivery_proof:
    "Confirms the customer received the package — strongest evidence against 'not received' claims",
  billing_address_match:
    "Matches the billing address to the order — critical for fraud disputes",
  avs_cvv_match:
    "Shows the card security checks passed — banks weigh this heavily in fraud cases",
  product_description:
    "Proves the product matched what was advertised — key defense for 'not as described' disputes",
  refund_policy:
    "Shows the customer agreed to your refund terms — protects against buyer's remorse claims",
  shipping_policy:
    "Documents your shipping commitments — supports delivery timeline disputes",
  cancellation_policy:
    "Proves the customer was informed of cancellation rules before purchase",
  customer_communication:
    "Shows you attempted to resolve the issue — banks favor merchants who engage",
  duplicate_explanation:
    "Explains why the charges are not duplicates — required for duplicate dispute responses",
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
  missingRequired: ChecklistItemUI[];
  missingRecommended: ChecklistItemUI[];
  unavailableItems?: ChecklistItemUI[];
  includedItems: IncludedItem[];
  onUpload: (field: string, files: File[]) => Promise<void>;
  uploadingField: string | null;
  failedFields: Map<string, string>;
  onReplace?: (field: string, files: File[]) => Promise<void>;
  replacingField: string | null;
  /** Field to auto-focus (scroll + expand uploader). */
  focusField: string | null;
  onFocusHandled: () => void;
  readOnly?: boolean;
}

export function EvidenceBuilderSection({
  missingRequired,
  missingRecommended,
  unavailableItems = [],
  includedItems,
  onUpload,
  uploadingField,
  failedFields,
  onReplace,
  replacingField,
  focusField,
  onFocusHandled,
  readOnly = false,
}: EvidenceBuilderSectionProps) {
  const [includedOpen, setIncludedOpen] = useState(readOnly);
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
    // Clear after a short delay so the highlight animation plays
    const timer = setTimeout(() => onFocusHandled(), 1200);
    return () => clearTimeout(timer);
  }, [focusField, onFocusHandled]);

  const sortedRequired = sortByPriority(missingRequired);
  const sortedRecommended = sortByPriority(missingRecommended);

  const hasRequired = sortedRequired.length > 0;
  const hasRecommended = sortedRecommended.length > 0;
  const hasIncluded = includedItems.length > 0;
  const hasUnavailable = unavailableItems.length > 0;
  const isEmpty = !hasRequired && !hasRecommended && !hasIncluded && !hasUnavailable;

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
      {/* A. Required Evidence */}
      {hasRequired && (
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                Required evidence
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Complete these items to unblock submission
              </Text>
            </BlockStack>

            {sortedRequired.map((item) => (
              <EvidenceItemRow
                key={item.field}
                ref={setItemRef(item.field)}
                item={item}
                variant="required"
                whyText={getWhyText(item.field)}
                onUpload={onUpload}
                isUploading={uploadingField === item.field}
                errorMessage={failedFields.get(item.field)}
                autoExpand={focusField === item.field}
                highlighted={focusField === item.field}
                readOnly={readOnly}
              />
            ))}
          </BlockStack>
        </Card>
      )}

      {/* B. Recommended Evidence */}
      {hasRecommended && (
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                Recommended evidence
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Optional — improves your chances
              </Text>
            </BlockStack>

            {sortedRecommended.map((item) => (
              <EvidenceItemRow
                key={item.field}
                ref={setItemRef(item.field)}
                item={item}
                variant="recommended"
                whyText={getWhyText(item.field)}
                onUpload={onUpload}
                isUploading={uploadingField === item.field}
                errorMessage={failedFields.get(item.field)}
                autoExpand={focusField === item.field}
                highlighted={focusField === item.field}
                readOnly={readOnly}
              />
            ))}
          </BlockStack>
        </Card>
      )}

      {/* C. Unavailable for this order */}
      {unavailableItems.length > 0 && (
        <Card>
          <BlockStack gap="200">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd" tone="subdued">
                Not available for this order
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {"These fields cannot be collected because of the order\u2019s payment method or fulfillment state"}
              </Text>
            </BlockStack>
            {unavailableItems.map((item) => (
              <div
                key={item.field}
                style={{ padding: "8px 12px", borderRadius: 8, background: "#f5f5f5", opacity: 0.7 }}
              >
                <BlockStack gap="050">
                  <InlineStack gap="200" blockAlign="center">
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

      {/* D. Already Included */}
      {hasIncluded && (
        <Card>
          <BlockStack gap="200">
            <Button
              variant="plain"
              onClick={() => setIncludedOpen((v) => !v)}
              disclosure={includedOpen ? "up" : "down"}
              icon={includedOpen ? ChevronUpIcon : ChevronDownIcon}
            >
              {`Already included in your submission (${includedItems.length} ${includedItems.length === 1 ? "item" : "items"})`}
            </Button>

            <Collapsible open={includedOpen} id="already-included">
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
            </Collapsible>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

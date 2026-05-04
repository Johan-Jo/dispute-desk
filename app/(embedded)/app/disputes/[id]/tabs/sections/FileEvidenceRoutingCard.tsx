/**
 * FileEvidenceRoutingCard — Phase 6 transparency in Review & Submit.
 *
 * Reads `pack.attachmentUploads` (set by saveToShopifyJob's file
 * evidence pipeline) and renders one row per native attachment so the
 * merchant can see, at a glance, which `*File` slot in Shopify Admin's
 * chargeback response screen will be populated by which evidence item.
 *
 * Suppressed entirely when:
 *   - the file evidence flag is off (no entries),
 *   - the pack hasn't been saved yet,
 *   - no candidates resolved to a native slot.
 */

"use client";

import { Card, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";

const TARGET_FIELD_LABEL: Record<string, string> = {
  shippingDocumentationFile: "Shipping documentation",
  customerCommunicationFile: "Customer communication",
  serviceDocumentationFile: "Proof of service",
  refundPolicyFile: "Refund policy",
  cancellationPolicyFile: "Cancellation policy",
  uncategorizedFile: "Other evidence",
};

const FIELD_KEY_LABEL: Record<string, string> = {
  delivery_proof: "Delivery confirmation",
  shipping_tracking: "Shipping tracking",
  customer_communication: "Customer communication",
  activity_log: "Customer activity",
  supporting_documents: "Supporting document",
  refund_policy: "Refund policy",
  shipping_policy: "Shipping policy",
  cancellation_policy: "Cancellation policy",
};

export interface NativeAttachmentRouting {
  evidenceItemId: string;
  evidenceFieldKey: string;
  targetField: string;
  uploadedAt: string;
}

export function FileEvidenceRoutingCard({
  uploads,
}: {
  uploads: NativeAttachmentRouting[];
}) {
  if (!uploads || uploads.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h3" variant="headingMd">
            Files attached natively to Shopify
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            These files are uploaded to Shopify&rsquo;s named evidence rows so
            the issuer sees them populated on the chargeback response screen.
            Your original uploaded files remain available as labelled secure
            links inside the evidence text.
          </Text>
        </BlockStack>

        <BlockStack gap="200">
          {uploads.map((u) => {
            const fieldLabel =
              FIELD_KEY_LABEL[u.evidenceFieldKey] ?? u.evidenceFieldKey;
            const slotLabel =
              TARGET_FIELD_LABEL[u.targetField] ?? u.targetField;
            return (
              <InlineStack
                key={u.evidenceItemId}
                gap="200"
                blockAlign="center"
                align="space-between"
              >
                <Text as="p" variant="bodyMd">
                  {fieldLabel} <Text as="span" tone="subdued">→</Text>{" "}
                  <strong>{slotLabel} file</strong>
                </Text>
                <Badge tone="success">Attached</Badge>
              </InlineStack>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

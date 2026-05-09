/**
 * EvidenceRow — denser per-item row used by EvidenceUsedSection.
 *
 * Layout:
 *   [title + optional attachment badge]                      [Source · X]
 *   <one concise reason-aware sentence>
 *
 * The strength badge is rendered at the bucket level by the parent
 * section, so each row is visually quiet and homogeneous within a
 * bucket. The native-attachment badge stays — it tells the merchant
 * which Shopify file row their upload populated.
 */

"use client";

import { BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type {
  EvidenceRowViewModel,
  EvidenceSource,
} from "../useEvidenceSections";

function sourceLabel(
  source: EvidenceSource,
  t: ReturnType<typeof useTranslations>,
): string {
  if (source === "shopify") return t("sourceShopify");
  if (source === "merchant") return t("sourceMerchant");
  return t("sourceDerived");
}

const TARGET_FIELD_LABEL: Record<string, string> = {
  shippingDocumentationFile: "Shipping documentation",
  customerCommunicationFile: "Customer communication",
  serviceDocumentationFile: "Proof of service",
  refundPolicyFile: "Refund policy",
  cancellationPolicyFile: "Cancellation policy",
  uncategorizedFile: "Other evidence",
};

export function EvidenceRow({ item }: { item: EvidenceRowViewModel }) {
  const t = useTranslations("disputes.evidenceTab.row");

  return (
    <BlockStack gap="100">
      <InlineStack
        align="space-between"
        blockAlign="start"
        gap="300"
        wrap
      >
        <InlineStack gap="200" blockAlign="center">
          <Text as="h4" variant="headingSm">
            {item.title}
          </Text>
          {item.nativeAttachment ? (
            <Badge tone="success">
              {`📎 Attached to ${
                TARGET_FIELD_LABEL[item.nativeAttachment.targetField] ??
                item.nativeAttachment.targetField
              }`}
            </Badge>
          ) : null}
        </InlineStack>
        <Text as="span" variant="bodySm" tone="subdued">
          {`${t("source")} · ${sourceLabel(item.source, t)}`}
        </Text>
      </InlineStack>

      <Text as="p" variant="bodySm">
        {item.whyThisMatters}
      </Text>
    </BlockStack>
  );
}

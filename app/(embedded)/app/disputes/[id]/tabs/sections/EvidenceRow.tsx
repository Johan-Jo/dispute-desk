/**
 * EvidenceRow — the four-question row primitive.
 *
 * Each row answers (in this order):
 *   1. What it is        (title)
 *   2. Why this matters  (one concise reason-aware sentence)
 *   3. Source            (Shopify / Merchant upload / Derived)
 *   4. Included as       (Form field / Rebuttal text / Not included)
 *
 * Used by EvidenceUsedSection. The strength badge is rendered at the
 * row level (Strong | Moderate | Supporting) and ordered by the
 * parent section.
 */

"use client";

import { BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type {
  EvidenceRowViewModel,
  EvidenceSource,
  ItemStrength,
} from "../useEvidenceSections";
import { RowStatusChip } from "./RowStatusChip";

function strengthTone(
  strength: ItemStrength,
): "success" | "attention" | "info" {
  if (strength === "strong") return "success";
  if (strength === "moderate") return "attention";
  return "info";
}

function sourceLabel(
  source: EvidenceSource,
  t: ReturnType<typeof useTranslations>,
): string {
  if (source === "shopify") return t("sourceShopify");
  if (source === "merchant") return t("sourceMerchant");
  return t("sourceDerived");
}

export function EvidenceRow({ item }: { item: EvidenceRowViewModel }) {
  const t = useTranslations("disputes.evidenceTab.row");
  const tStrength = useTranslations("disputes.itemStrength");

  return (
    <BlockStack gap="100">
      <InlineStack align="space-between" blockAlign="center" gap="200">
        <InlineStack gap="200" blockAlign="center">
          <Text as="h4" variant="headingSm">
            {item.title}
          </Text>
          <Badge tone={strengthTone(item.strength)}>
            {tStrength(item.strength)}
          </Badge>
        </InlineStack>
        <RowStatusChip destination={item.includedAs} />
      </InlineStack>

      <Text as="p" variant="bodySm" tone="subdued">
        <strong>{t("whyThisMatters")}:</strong> {item.whyThisMatters}
      </Text>

      <Text as="p" variant="bodySm" tone="subdued">
        <strong>{t("source")}:</strong> {sourceLabel(item.source, t)}
      </Text>
    </BlockStack>
  );
}

/**
 * InternalOnlySignalsSection — Section 4 of EvidenceTab.
 *
 * Always rendered. When non-empty: lists negative-but-merchant-visible
 * signals that are intentionally NOT submitted to Shopify (e.g., AVS
 * mismatch, IP geolocation mismatch). When empty: renders an explicit
 * informational line so the merchant gets a definitive answer to "is
 * anything being held back?"
 *
 * Honors feedback_bank_optimized_rebuttal.md — weakening signals are
 * visible to the merchant but never appear under any "submitted"
 * section.
 */

"use client";

import { Card, BlockStack, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { InternalSignalViewModel } from "../useEvidenceSections";

function InternalSignalRow({ signal }: { signal: InternalSignalViewModel }) {
  return (
    <BlockStack gap="050">
      <Text as="h4" variant="headingSm">
        {signal.title}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {signal.explanation}
      </Text>
    </BlockStack>
  );
}

export function InternalOnlySignalsSection({
  items,
}: {
  items: InternalSignalViewModel[];
}) {
  const t = useTranslations("disputes.evidenceTab.sections.internalOnly");

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("title")}
        </Text>

        {items.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("emptyState")}
          </Text>
        ) : (
          <BlockStack gap="300">
            {items.map((signal) => (
              <InternalSignalRow key={signal.id} signal={signal} />
            ))}
            <Text as="p" variant="bodySm" tone="subdued">
              {t("disclaimer")}
            </Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

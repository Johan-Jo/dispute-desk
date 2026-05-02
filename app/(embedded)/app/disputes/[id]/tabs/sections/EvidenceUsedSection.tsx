/**
 * EvidenceUsedSection — Section 2 of EvidenceTab.
 *
 * Lists ALL signals that support the case, ordered Strong → Moderate
 * → Supporting. Each row carries an explicit "Submitted to Shopify:
 * Yes/No" chip; both states are first-class. A row with `No` here is
 * a positive signal that does not happen to be in the bank-visible
 * payload — it is NOT internal-only. Internal-only is §4.
 *
 * The submitted subset must match the output of
 * lib/shopify/formatEvidenceForShopify.ts byte-for-byte (verification
 * step #2 in the plan). This section never editorializes.
 */

"use client";

import { Card, BlockStack, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { EvidenceRowViewModel } from "../useEvidenceSections";
import { EvidenceRow } from "./EvidenceRow";

export function EvidenceUsedSection({
  items,
}: {
  items: EvidenceRowViewModel[];
}) {
  const t = useTranslations("disputes.evidenceTab.sections.used");

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("title")}
        </Text>

        {items.map((item) => (
          <EvidenceRow key={item.id} item={item} />
        ))}
      </BlockStack>
    </Card>
  );
}

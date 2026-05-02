/**
 * EvidenceUsedSection — Section 2 of EvidenceTab.
 *
 * Lists ALL signals that support the case, ordered Strong → Moderate
 * → Supporting. Each row carries an explicit "Included as" chip:
 * `form_field` (structured Shopify field/attachment), `rebuttal_text`
 * (folded into the bank-facing narrative), or `not_included`
 * (waived/excluded from the submission). All three states are
 * first-class — there is no "Unknown" state. Internal-only is §4.
 *
 * The form_field subset must match the output of
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
        <Text as="p" variant="bodySm" tone="subdued">
          {t("destinationExplainer")}
        </Text>

        {items.map((item) => (
          <EvidenceRow key={item.id} item={item} />
        ))}
      </BlockStack>
    </Card>
  );
}

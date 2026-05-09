/**
 * EvidenceUsedSection — Section 2 of EvidenceTab.
 *
 * Lists ALL signals that support the case, grouped into Strong /
 * Moderate / Supporting buckets. The bucket header carries the
 * strength badge so individual rows no longer need to repeat it.
 *
 * The form_field subset must match the output of
 * lib/shopify/formatEvidenceForShopify.ts byte-for-byte. This section
 * never editorializes.
 */

"use client";

import { Card, BlockStack, InlineStack, Box, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import type {
  EvidenceRowViewModel,
  ItemStrength,
} from "../useEvidenceSections";
import { EvidenceRow } from "./EvidenceRow";

const BUCKET_ORDER: ItemStrength[] = ["strong", "moderate", "supporting"];

function bucketTone(
  strength: ItemStrength,
): "success" | "attention" | "info" {
  if (strength === "strong") return "success";
  if (strength === "moderate") return "attention";
  return "info";
}

export function EvidenceUsedSection({
  items,
}: {
  items: EvidenceRowViewModel[];
}) {
  const t = useTranslations("disputes.evidenceTab.sections.used");
  const tStrength = useTranslations("disputes.itemStrength");

  const buckets: Record<ItemStrength, EvidenceRowViewModel[]> = {
    strong: [],
    moderate: [],
    supporting: [],
  };
  for (const item of items) {
    buckets[item.strength].push(item);
  }

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("destinationExplainer")}
          </Text>
        </BlockStack>

        {(() => {
          const visibleBuckets = BUCKET_ORDER.filter(
            (bucket) => buckets[bucket].length > 0,
          );
          return visibleBuckets.map((bucket, visibleIndex) => {
            const rows = buckets[bucket];
            return (
              <BlockStack key={bucket} gap="300">
                {visibleIndex > 0 ? (
                  <Box
                    borderBlockStartWidth="025"
                    borderColor="border"
                    paddingBlockStart="400"
                  />
                ) : null}
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={bucketTone(bucket)}>{tStrength(bucket)}</Badge>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`(${rows.length})`}
                  </Text>
                </InlineStack>
                {rows.map((item, rowIndex) => (
                  <Fragment key={item.id}>
                    {rowIndex > 0 ? (
                      <Box
                        borderBlockStartWidth="025"
                        borderColor="border"
                        paddingBlockStart="300"
                      >
                        <EvidenceRow item={item} />
                      </Box>
                    ) : (
                      <EvidenceRow item={item} />
                    )}
                  </Fragment>
                ))}
              </BlockStack>
            );
          });
        })()}
      </BlockStack>
    </Card>
  );
}

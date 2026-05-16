/**
 * EvidenceUsedSection — Section 2 of EvidenceTab.
 *
 * Lists ALL signals associated with the case, grouped by what reaches
 * the bank:
 *   - "Sent to the bank"   → strong + moderate tiers
 *   - "On file — not sent" → supporting tier (would weaken the case)
 *
 * The two-bucket split is intentional: previously the section was titled
 * "Evidence used in defense" with three strength tiers, which implied
 * all listed items were sent to the bank. They weren't — `lib/defence/
 * pdf/evidenceBasisRows.ts` filters out supporting facts because a
 * customer with 0 prior orders or a policy that wasn't accepted at
 * checkout are negative signals that hurt the bank submission rather
 * than support it.
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

type Bucket = "sent" | "withheld";

function bucketFor(strength: ItemStrength): Bucket {
  return strength === "supporting" ? "withheld" : "sent";
}

export function EvidenceUsedSection({
  items,
}: {
  items: EvidenceRowViewModel[];
}) {
  const t = useTranslations("disputes.evidenceTab.sections.used");

  const buckets: Record<Bucket, EvidenceRowViewModel[]> = {
    sent: [],
    withheld: [],
  };
  for (const item of items) {
    buckets[bucketFor(item.strength)].push(item);
  }

  const visible: Array<{
    bucket: Bucket;
    rows: EvidenceRowViewModel[];
    headerKey: "groupSent" | "groupWithheld";
    captionKey: "groupWithheldCaption" | null;
    tone: "success" | "subdued";
  }> = [
    {
      bucket: "sent",
      rows: buckets.sent,
      headerKey: "groupSent",
      captionKey: null,
      tone: "success",
    },
    {
      bucket: "withheld",
      rows: buckets.withheld,
      headerKey: "groupWithheld",
      captionKey: "groupWithheldCaption",
      tone: "subdued",
    },
  ].filter((g) => g.rows.length > 0) as typeof visible;

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

        {visible.map((group, groupIndex) => (
          <BlockStack key={group.bucket} gap="300">
            {groupIndex > 0 ? (
              <Box
                borderBlockStartWidth="025"
                borderColor="border"
                paddingBlockStart="400"
              />
            ) : null}
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={group.tone === "success" ? "success" : undefined}>
                {`${t(group.headerKey)} (${group.rows.length})`}
              </Badge>
            </InlineStack>
            {group.captionKey ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {t(group.captionKey)}
              </Text>
            ) : null}
            {group.rows.map((item, rowIndex) => (
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
        ))}
      </BlockStack>
    </Card>
  );
}

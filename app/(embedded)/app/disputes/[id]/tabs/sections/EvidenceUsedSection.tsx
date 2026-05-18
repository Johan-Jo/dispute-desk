/**
 * EvidenceUsedSection — Section 2 of EvidenceTab.
 *
 * Renders every evidence row in three buckets, gated by the line-item
 * booleans (NOT by the legacy `strength` field):
 *
 *   1. "Used as positive bank argument" — `usedAsPositiveBankEvidence`
 *   2. "Context only"                   — `includedInDefencePackage && !usedAsPositiveBankEvidence`
 *   3. "On file — not included"         — everything else with `hasEvidence`
 *
 * The explainer is conditional:
 *   - At least one positive bank evidence row → enumerate the fields
 *   - Zero positive bank evidence rows         → "no decisive bank-facing evidence is available"
 *
 * Hard rule: the explainer never claims strong bank-facing evidence
 * exists unless the booleans confirm it. The unconditional "Strong
 * evidence is included in the defence package sent to the bank" copy
 * is gone.
 */

"use client";

import { Card, BlockStack, InlineStack, Box, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";
import type { EvidenceRowViewModel } from "../useEvidenceSections";
import type { EvidenceLineItem } from "@/lib/argument/evidenceLineItem";
import { EvidenceRow } from "./EvidenceRow";

type Bucket = "bankArgument" | "contextOnly" | "notIncluded";

interface BucketSpec {
  bucket: Bucket;
  rows: EvidenceRowViewModel[];
  headerKey: "groupUsedInBankArgument" | "groupContextOnly" | "groupNotIncluded";
  captionKey: "groupContextOnlyCaption" | "groupNotIncludedCaption" | null;
  tone: "success" | "subdued";
}

function bucketForRow(row: EvidenceRowViewModel, lineItem: EvidenceLineItem | undefined): Bucket {
  if (lineItem) {
    if (lineItem.usedAsPositiveBankEvidence) return "bankArgument";
    if (lineItem.includedInDefencePackage) return "contextOnly";
    return "notIncluded";
  }
  // Fallback when the workspace API hasn't yet returned evidenceLineItems
  // (older client cache, transient state). Match the historical split so
  // the section never looks empty: strong/moderate → bankArgument,
  // supporting → notIncluded. The contextOnly bucket stays empty in this
  // fallback path — strictly more accurate to under-claim than over-claim.
  return row.strength === "supporting" ? "notIncluded" : "bankArgument";
}

export function EvidenceUsedSection({
  items,
  lineItems,
}: {
  items: EvidenceRowViewModel[];
  lineItems: EvidenceLineItem[];
}) {
  const t = useTranslations("disputes.evidenceTab.sections.used");

  const lineItemsByField = useMemo(() => {
    const m = new Map<string, EvidenceLineItem>();
    for (const li of lineItems) m.set(li.field, li);
    return m;
  }, [lineItems]);

  const buckets: Record<Bucket, EvidenceRowViewModel[]> = {
    bankArgument: [],
    contextOnly: [],
    notIncluded: [],
  };
  for (const item of items) {
    const li = lineItemsByField.get(item.field);
    buckets[bucketForRow(item, li)].push(item);
  }

  const visible: BucketSpec[] = (
    [
      {
        bucket: "bankArgument" as const,
        rows: buckets.bankArgument,
        headerKey: "groupUsedInBankArgument" as const,
        captionKey: null,
        tone: "success" as const,
      },
      {
        bucket: "contextOnly" as const,
        rows: buckets.contextOnly,
        headerKey: "groupContextOnly" as const,
        captionKey: "groupContextOnlyCaption" as const,
        tone: "subdued" as const,
      },
      {
        bucket: "notIncluded" as const,
        rows: buckets.notIncluded,
        headerKey: "groupNotIncluded" as const,
        captionKey: "groupNotIncludedCaption" as const,
        tone: "subdued" as const,
      },
    ] satisfies BucketSpec[]
  ).filter((g) => g.rows.length > 0);

  // Conditional explainer — the central truthfulness gate. Only renders
  // "bank-facing evidence used" copy when at least one row is actually
  // a positive bank argument.
  const explainer =
    buckets.bankArgument.length > 0
      ? t("explainerHasBankFacing", {
          fields: buckets.bankArgument.map((r) => r.title).join(", "),
        })
      : t("explainerNoBankFacing");

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {explainer}
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
            {group.rows.map((item, rowIndex) => {
              const li = lineItemsByField.get(item.field);
              return (
                <Fragment key={item.id}>
                  {rowIndex > 0 ? (
                    <Box
                      borderBlockStartWidth="025"
                      borderColor="border"
                      paddingBlockStart="300"
                    >
                      <EvidenceRow item={item} lineItem={li} />
                    </Box>
                  ) : (
                    <EvidenceRow item={item} lineItem={li} />
                  )}
                </Fragment>
              );
            })}
          </BlockStack>
        ))}
      </BlockStack>
    </Card>
  );
}

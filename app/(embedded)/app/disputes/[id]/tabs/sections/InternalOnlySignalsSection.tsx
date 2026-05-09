/**
 * InternalOnlySignalsSection — Section 4 of EvidenceTab.
 *
 * Always rendered. The disclaimer leads (so the merchant reads the
 * framing before the signals), then the list, with thin dividers
 * between heterogeneous signals. When empty, an explicit
 * informational line answers "is anything being held back?".
 *
 * Honors feedback_bank_optimized_rebuttal.md — weakening signals are
 * visible to the merchant but never appear under any "submitted"
 * section.
 */

"use client";

import { Card, BlockStack, Box, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import type { InternalSignalViewModel } from "../useEvidenceSections";

function InternalSignalRow({ signal }: { signal: InternalSignalViewModel }) {
  return (
    <BlockStack gap="100">
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
            <Text as="p" variant="bodySm" tone="subdued">
              {t("disclaimer")}
            </Text>
            <BlockStack gap="300">
              {items.map((signal, index) => (
                <Fragment key={signal.id}>
                  {index > 0 ? (
                    <Box
                      borderBlockStartWidth="025"
                      borderColor="border"
                      paddingBlockStart="300"
                    >
                      <InternalSignalRow signal={signal} />
                    </Box>
                  ) : (
                    <InternalSignalRow signal={signal} />
                  )}
                </Fragment>
              ))}
            </BlockStack>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

/**
 * NotSubmittedCard — Section 3 of ReviewSubmitTab.
 *
 * Lists items that exist in the pack but are excluded from the
 * bank-visible payload. Each row carries a stable reason from a
 * fixed dictionary — never free-text — so the merchant always knows
 * WHY something is held back.
 *
 * Default reason is "avoid_weakening" (the rebuttal must never
 * expose weaknesses; memory: feedback_bank_optimized_rebuttal.md).
 */

"use client";

import { Card, BlockStack, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type {
  NotSubmittedRowViewModel,
  NotSubmittedReason,
} from "../useReviewView";

function reasonKey(reason: NotSubmittedReason): string {
  if (reason === "gateway_gated") return "reasonGatewayGated";
  if (reason === "merchant_waived") return "reasonMerchantWaived";
  if (reason === "write_only") return "reasonWriteOnly";
  return "reasonAvoidWeakening";
}

function NotSubmittedRow({
  row,
  t,
}: {
  row: NotSubmittedRowViewModel;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <BlockStack gap="050">
      <Text as="h4" variant="headingSm">
        {row.title}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {row.explanation}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        <em>{t(reasonKey(row.reason))}</em>
      </Text>
    </BlockStack>
  );
}

export function NotSubmittedCard({
  items,
}: {
  items: NotSubmittedRowViewModel[];
}) {
  const t = useTranslations("disputes.reviewTab.sections.notSubmitted");

  if (items.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {t("title")}
        </Text>

        <BlockStack gap="300">
          {items.map((row) => (
            <NotSubmittedRow key={row.id} row={row} t={t} />
          ))}
        </BlockStack>

        <Text as="p" variant="bodySm" tone="subdued">
          {t("disclaimer")}
        </Text>
      </BlockStack>
    </Card>
  );
}

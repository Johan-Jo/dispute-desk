/**
 * ExactDataSentCard — Section 3 of ReviewSubmitTab.
 *
 * Post-retirement shape (2026-05-16): renders ONLY the merchant-facing
 * mirror of the four-field Shopify mutation contract:
 *   - customerFirstName / customerLastName / customerEmailAddress (if set)
 *   - The defence-package PDF attachment
 *
 * No structured text fields, no group rendering, no six-bucket layout.
 * The bank reads the PDF; this card shows the merchant what's about to
 * land in Shopify's chargeback response form alongside it.
 */

"use client";

import { Card, BlockStack, InlineStack, Text, Badge, Icon } from "@shopify/polaris";
import { FileIcon } from "@shopify/polaris-icons";
import { useTranslations } from "next-intl";
import type { ReviewState, DataSentPayload } from "../useReviewView";

interface Props {
  state: ReviewState;
  payload: DataSentPayload | null;
  loading?: boolean;
}

export function ExactDataSentCard({ state, payload, loading = false }: Props) {
  const t = useTranslations("disputes.reviewTab.sections.dataSent");
  const titleKey = state === "submitted" ? "title.submitted" : "title.unsubmitted";

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t(titleKey)}
          </Text>
          {loading ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("loading")}
            </Text>
          ) : null}
        </BlockStack>

        {payload === null ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("empty")}
          </Text>
        ) : (
          <BlockStack gap="400">
            {payload.customer.length > 0 ? (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Customer details
                </Text>
                {payload.customer.map((field) => (
                  <InlineStack
                    key={field.shopifyFieldName}
                    gap="200"
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <Text as="span" variant="bodySm" tone="subdued">
                      {field.label}
                    </Text>
                    <Text as="span" variant="bodyMd">
                      {field.content}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            ) : null}

            {payload.pdf ? (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Attachment
                </Text>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Icon source={FileIcon} />
                  <Text as="span" variant="bodyMd">
                    {payload.pdf.fileName}
                  </Text>
                  <Badge tone="info">Defence Package PDF</Badge>
                </InlineStack>
              </BlockStack>
            ) : null}
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

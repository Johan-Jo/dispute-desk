"use client";

import { useTranslations } from "next-intl";
import { Page, Card, Text, BlockStack, Button } from "@shopify/polaris";

export default function EmbeddedPoliciesPage() {
  const t = useTranslations("nav");

  return (
    <Page fullWidth title={t("policies")} backAction={{ content: t("overview"), url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            Add or edit your refund, return, shipping, and terms policies. These are included
            in evidence packs. Use the portal for full policy management.
          </Text>
          <Button url="/portal/policies" variant="primary">
            Open policies in portal
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

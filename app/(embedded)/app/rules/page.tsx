"use client";

import { useTranslations } from "next-intl";
import { Page, Card, Text, BlockStack, Button } from "@shopify/polaris";

export default function EmbeddedRulesPage() {
  const t = useTranslations("nav");

  return (
    <Page title={t("rules")} backAction={{ content: t("overview"), url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            Configure automation rules to attach evidence packs to disputes, send notifications,
            and control auto-save. Use the portal for full rule management.
          </Text>
          <Button url="/portal/rules" variant="primary">
            Open rules in portal
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

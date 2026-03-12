"use client";

import { useTranslations } from "next-intl";
import { Page, Card, Text, BlockStack, Button } from "@shopify/polaris";

export default function EmbeddedSettingsPage() {
  const t = useTranslations("nav");

  return (
    <Page title={t("settings")} backAction={{ content: t("overview"), url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            Configure auto-build and auto-save, completeness thresholds, and review requirements.
            Use the portal for full settings.
          </Text>
          <Button url="/portal/settings" variant="primary">
            Open settings in portal
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

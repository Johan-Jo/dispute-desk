"use client";

import { useTranslations } from "next-intl";
import { Page, Card, Text, BlockStack, Button } from "@shopify/polaris";

export default function EmbeddedTeamPage() {
  const tNav = useTranslations("nav");
  const t = useTranslations("team");

  return (
    <Page title={tNav("team")} backAction={{ content: tNav("overview"), url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            {t("description")}
          </Text>
          <Button url="/portal/team" variant="primary">
            {t("openInPortal")}
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

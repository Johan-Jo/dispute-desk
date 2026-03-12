"use client";

import { useTranslations } from "next-intl";
import { Page, Card, Text, BlockStack, Button } from "@shopify/polaris";

export default function EmbeddedTeamPage() {
  const t = useTranslations("nav");

  return (
    <Page title={t("team")} backAction={{ content: t("overview"), url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            Invite team members and configure notifications for new disputes, due dates, and
            evidence ready for review. Use the portal for full team management.
          </Text>
          <Button url="/portal/team" variant="primary">
            Open team in portal
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}

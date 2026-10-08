"use client";

import { useTranslations } from "next-intl";
import { Page, Layout, Card, BlockStack, Text } from "@shopify/polaris";

/**
 * Shown in place of the whole embedded app when the store has no orders
 * (docs/plans/no-orders-install-gate.plan.md). Rendered by the `/app/*` layout
 * INSTEAD of the nav and page content, so there is nothing to browse.
 */
export function NoOrdersScreen() {
  const t = useTranslations("noOrdersGate");
  return (
    <Page narrowWidth>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h1" variant="headingLg">
                {t("title")}
              </Text>
              <Text as="p" variant="bodyMd">
                {t("body")}
              </Text>
              <Text as="p" variant="bodyMd">
                {t("welcomeBack")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("contact")}{" "}
                <a href="mailto:support@disputedesk.app">support@disputedesk.app</a>
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

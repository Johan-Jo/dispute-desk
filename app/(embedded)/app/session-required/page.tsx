"use client";

import { useSearchParams } from "next/navigation";
import { Page, Card, Text, Button, BlockStack, Banner } from "@shopify/polaris";
import { useTranslations } from "next-intl";

export default function SessionRequiredPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  return (
    <Page title={t("sessionRequired.title")} narrowWidth>
      <BlockStack gap="400">
        <Banner title={t("sessionRequired.bannerTitle")} tone="warning">
          <p>{t("sessionRequired.bannerBody")}</p>
        </Banner>

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              {t("sessionRequired.instructions")}
            </Text>

            <Button variant="primary" onClick={() => window.location.reload()}>
              {t("common.retry")}
            </Button>

            {returnTo && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("sessionRequired.returnTo", { path: returnTo })}
              </Text>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

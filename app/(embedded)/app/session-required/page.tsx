"use client";

import { useSearchParams } from "next/navigation";
import { Page, Card, Text, Button, BlockStack, Banner, InlineStack } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { SHOPIFY_INSTALL_URL } from "@/lib/marketing/shopifyInstallUrl";

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

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              {t("sessionRequired.installHint")}
            </Text>
            <InlineStack gap="300">
              <Button url={SHOPIFY_INSTALL_URL} external>
                {t("sessionRequired.installCta")}
              </Button>
              <Button url="/" variant="plain">
                {t("sessionRequired.learnMore")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

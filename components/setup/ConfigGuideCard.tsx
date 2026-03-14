"use client";

import { useState, useEffect } from "react";
import { Card, BlockStack, InlineStack, Text, Button } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { openInAdmin } from "@/lib/embedded/openInAdmin";

const STORAGE_KEY = "dd_config_guide_dismissed";

export function ConfigGuideCard() {
  const t = useTranslations("configGuide");
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          <Button variant="plain" onClick={handleDismiss}>
            {t("dismiss")}
          </Button>
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          {t("description")}
        </Text>
        <Button
          variant="primary"
          onClick={() => openInAdmin({ newContext: true })}
        >
          {t("cta")}
        </Button>
      </BlockStack>
    </Card>
  );
}

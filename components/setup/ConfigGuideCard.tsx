"use client";

import { useState, useEffect } from "react";
import { Card, BlockStack, InlineStack, Text, Button } from "@shopify/polaris";
import { openInAdmin } from "@/lib/embedded/openInAdmin";

const STORAGE_KEY = "dd_config_guide_dismissed";

export function ConfigGuideCard() {
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
            Quick access
          </Text>
          <Button variant="plain" onClick={handleDismiss}>
            Dismiss
          </Button>
        </InlineStack>
        <Text as="p" variant="bodyMd" tone="subdued">
          Pin the app in Shopify Admin to open DisputeDesk from your sidebar.
        </Text>
        <Button
          variant="primary"
          onClick={() => openInAdmin({ newContext: true })}
        >
          Open in Shopify Admin
        </Button>
      </BlockStack>
    </Card>
  );
}

"use client";

import { useEffect } from "react";
import { BlockStack, Text, Button } from "@shopify/polaris";
import { openInAdmin } from "@/lib/embedded/openInAdmin";
import type { StepId } from "@/lib/setup/types";

interface OpenInAdminStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function OpenInAdminStep({ stepId, onSaveRef }: OpenInAdminStepProps) {
  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: {} }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Open in Shopify Admin
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Open the app in your Shopify Admin to pin it to the sidebar for quick access.
      </Text>
      <Button
        variant="primary"
        onClick={() => openInAdmin({ newContext: true })}
      >
        Open in Shopify Admin
      </Button>
    </BlockStack>
  );
}

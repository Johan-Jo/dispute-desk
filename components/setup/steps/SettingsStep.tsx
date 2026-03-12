"use client";

import { useEffect } from "react";
import { BlockStack, Text, Button } from "@shopify/polaris";
import type { StepId } from "@/lib/setup/types";

interface SettingsStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function SettingsStep({ stepId, onSaveRef }: SettingsStepProps) {
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
        Settings
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Configure auto-build and auto-save, set completeness thresholds, and choose whether
        evidence requires manual review before saving to Shopify. Manage these in the Settings
        section.
      </Text>
      <Button url="/app/settings" variant="primary">
        Open settings
      </Button>
    </BlockStack>
  );
}

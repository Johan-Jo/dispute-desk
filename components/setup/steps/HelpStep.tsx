"use client";

import { useEffect } from "react";
import { BlockStack, Text, Button } from "@shopify/polaris";
import type { StepId } from "@/lib/setup/types";

interface HelpStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function HelpStep({ stepId, onSaveRef }: HelpStepProps) {
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
        Help & Resources
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Find guides, how-tos, and contact support from the Help section. You can also re-open
        this setup wizard from the dashboard checklist anytime.
      </Text>
      <Button url="/app/help" variant="primary">
        Open Help
      </Button>
    </BlockStack>
  );
}

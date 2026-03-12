"use client";

import { useEffect } from "react";
import { BlockStack, Text, Button } from "@shopify/polaris";
import type { StepId } from "@/lib/setup/types";

interface BillingStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function BillingStep({ stepId, onSaveRef }: BillingStepProps) {
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
        Billing & Plan
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Choose the plan that fits your dispute volume. You can view usage, upgrade, or add pack
        top-ups anytime from the Billing section.
      </Text>
      <Button url="/app/billing" variant="primary">
        View billing
      </Button>
    </BlockStack>
  );
}

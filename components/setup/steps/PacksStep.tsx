"use client";

import { useEffect } from "react";
import { BlockStack, Text, Button } from "@shopify/polaris";
import type { StepId } from "@/lib/setup/types";

interface PacksStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function PacksStep({ stepId, onSaveRef }: PacksStepProps) {
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
        Evidence Packs
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        DisputeDesk builds evidence packs for each dispute using templates. Packs pull in orders,
        tracking, policies, and uploads automatically. You can browse templates and customize
        packs from the Packs section.
      </Text>
      <Button url="/app/packs" variant="primary">
        View evidence packs
      </Button>
    </BlockStack>
  );
}

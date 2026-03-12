"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  RadioButton,
  Banner,
} from "@shopify/polaris";

import type { StepId } from "@/lib/setup/types";

interface AutomationRulesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function AutomationRulesStep({ stepId, onSaveRef }: AutomationRulesStepProps) {
  const [preset, setPreset] = useState("");

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { automationPreset: preset },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, preset]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Automation Rules
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Define how DisputeDesk should handle disputes automatically.
      </Text>

      <Text as="h3" variant="headingMd">
        Choose a preset
      </Text>

      <BlockStack gap="200">
        <RadioButton
          label="Conservative"
          helpText="Build evidence packs automatically, but you review and submit everything manually"
          checked={preset === "conservative"}
          id="preset-conservative"
          name="preset"
          onChange={() => setPreset("conservative")}
        />
        <RadioButton
          label="Balanced"
          helpText="Auto-submit low-risk disputes (under $100 with complete evidence)"
          checked={preset === "balanced"}
          id="preset-balanced"
          name="preset"
          onChange={() => setPreset("balanced")}
        />
      </BlockStack>

      {preset === "balanced" && (
        <Banner title="Auto-submit enabled" tone="warning">
          <p>
            DisputeDesk will automatically submit evidence for qualifying disputes.
            You can review and adjust any submission before the due date.
          </p>
        </Banner>
      )}
    </BlockStack>
  );
}

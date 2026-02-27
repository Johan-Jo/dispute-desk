"use client";

import { Card, BlockStack, Text, Icon, InlineStack, Divider } from "@shopify/polaris";
import { CheckCircleIcon, ClockIcon } from "@shopify/polaris-icons";
import { STEP_BY_ID } from "@/lib/setup/constants";
import type { StepId } from "@/lib/setup/types";

interface WhatThisUnlocksCardProps {
  stepId: StepId;
}

export function WhatThisUnlocksCard({ stepId }: WhatThisUnlocksCardProps) {
  const step = STEP_BY_ID[stepId];
  if (!step) return null;

  return (
    <div
      style={{
        background: "#F2F7FE",
        border: "1px solid #2C6ECB",
        borderRadius: 12,
        padding: 24,
        position: "sticky",
        top: 24,
      }}
    >
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd" fontWeight="semibold">
          What this unlocks
        </Text>

        <BlockStack gap="300">
          {step.unlocks.map((item, i) => (
            <InlineStack key={i} gap="200" blockAlign="start" wrap={false}>
              <div style={{ color: "#008060", flexShrink: 0, marginTop: 2 }}>
                <Icon source={CheckCircleIcon} />
              </div>
              <Text as="span" variant="bodySm" tone="subdued">
                {item}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>

        <Divider />

        <InlineStack gap="200" blockAlign="center">
          <Icon source={ClockIcon} tone="subdued" />
          <Text as="span" variant="bodySm" tone="subdued">
            Estimated: {step.timeEstimate}
          </Text>
        </InlineStack>
      </BlockStack>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  RadioButton,
  Banner,
  InlineStack,
  Icon,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";

interface WelcomeGoalsStepProps {
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function WelcomeGoalsStep({ onSaveRef }: WelcomeGoalsStepProps) {
  const [goal, setGoal] = useState("");

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "welcome_goals",
          payload: { primaryGoal: goal },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, goal]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Let&apos;s set up DisputeDesk
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        What&apos;s your top priority? This helps us personalize your setup.
      </Text>

      <BlockStack gap="200">
        <RadioButton
          label="Win more chargebacks"
          helpText="Build comprehensive evidence packs and increase win rates"
          checked={goal === "win"}
          id="goal-win"
          name="goal"
          onChange={() => setGoal("win")}
        />
        <RadioButton
          label="Reduce workload (automation)"
          helpText="Automate evidence collection and submission"
          checked={goal === "automate"}
          id="goal-automate"
          name="goal"
          onChange={() => setGoal("automate")}
        />
        <RadioButton
          label="Prevent disputes (alerts & policies)"
          helpText="Get early warnings and prevent chargebacks before they happen"
          checked={goal === "prevent"}
          id="goal-prevent"
          name="goal"
          onChange={() => setGoal("prevent")}
        />
      </BlockStack>

      <Banner tone="info" title="What you'll achieve in ~10 minutes">
        <BlockStack gap="200">
          {[
            "Connect your Shopify store and sync disputes",
            "Set up business policies and evidence sources",
            "Configure automation rules to save time",
            "Be ready to handle your first dispute",
          ].map((item) => (
            <InlineStack key={item} gap="200" blockAlign="center">
              <div style={{ color: "#008060" }}>
                <Icon source={CheckCircleIcon} />
              </div>
              <Text as="span" variant="bodySm">
                {item}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </Banner>
    </BlockStack>
  );
}

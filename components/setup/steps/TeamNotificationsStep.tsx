"use client";

import { useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  TextField,
  Checkbox,
  Button,
  InlineStack,
} from "@shopify/polaris";

interface TeamNotificationsStepProps {
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function TeamNotificationsStep({ onSaveRef }: TeamNotificationsStepProps) {
  const [teamEmail, setTeamEmail] = useState("");
  const [newDispute, setNewDispute] = useState(true);
  const [beforeDue, setBeforeDue] = useState(true);
  const [evidenceReady, setEvidenceReady] = useState(true);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "team_notifications",
          payload: {
            teamEmail,
            notifications: { newDispute, beforeDue, evidenceReady },
          },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, teamEmail, newDispute, beforeDue, evidenceReady]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Team & Notifications
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Invite teammates and configure how you want to be notified.
      </Text>

      <Text as="h3" variant="headingMd">
        Invite teammate (optional)
      </Text>
      <InlineStack gap="300" blockAlign="end">
        <div style={{ flex: 1 }}>
          <TextField
            label="Email address"
            labelHidden
            value={teamEmail}
            onChange={setTeamEmail}
            type="email"
            placeholder="teammate@example.com"
            autoComplete="off"
          />
        </div>
        <Button disabled={!teamEmail}>Send invite</Button>
      </InlineStack>

      <Text as="h3" variant="headingMd">
        Email notifications
      </Text>
      <BlockStack gap="200">
        <Checkbox
          label="New dispute detected"
          helpText="Get notified when a new dispute arrives"
          checked={newDispute}
          onChange={setNewDispute}
        />
        <Checkbox
          label="48h before due date"
          helpText="Reminder to submit evidence"
          checked={beforeDue}
          onChange={setBeforeDue}
        />
        <Checkbox
          label="Evidence pack ready"
          helpText="When automated evidence is compiled"
          checked={evidenceReady}
          onChange={setEvidenceReady}
        />
      </BlockStack>
    </BlockStack>
  );
}

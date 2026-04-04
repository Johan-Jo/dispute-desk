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

import type { StepId } from "@/lib/setup/types";

interface TeamNotificationsStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function TeamNotificationsStep({ stepId, onSaveRef }: TeamNotificationsStepProps) {
  const [teamEmail, setTeamEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [newDispute, setNewDispute] = useState(true);
  const [beforeDue, setBeforeDue] = useState(true);
  const [evidenceReady, setEvidenceReady] = useState(true);

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: {
            teamEmail,
            notifications: { newDispute, beforeDue, evidenceReady },
          },
        }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, teamEmail, newDispute, beforeDue, evidenceReady]);

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
        <Button
          disabled={!teamEmail || inviteSending || inviteSent}
          loading={inviteSending}
          onClick={async () => {
            setInviteSending(true);
            setInviteError(null);
            try {
              const res = await fetch("/api/setup/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: teamEmail }),
              });
              if (res.ok) {
                setInviteSent(true);
              } else {
                const data = await res.json().catch(() => ({}));
                setInviteError(data.error ?? "Failed to send invite");
              }
            } catch {
              setInviteError("Network error — please try again");
            } finally {
              setInviteSending(false);
            }
          }}
        >
          {inviteSent ? "Invite sent!" : "Send invite"}
        </Button>
      </InlineStack>

      {inviteError && (
        <Text as="p" variant="bodySm" tone="critical">
          {inviteError}
        </Text>
      )}

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

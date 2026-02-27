"use client";

import { useState } from "react";
import {
  Modal,
  FormLayout,
  TextField,
  BlockStack,
  Text,
  Banner,
  InlineStack,
  Button,
} from "@shopify/polaris";

interface ConnectGorgiasModalProps {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export function ConnectGorgiasModal({
  open,
  onClose,
  onConnected,
}: ConnectGorgiasModalProps) {
  const [subdomain, setSubdomain] = useState("");
  const [email, setEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canSubmit = subdomain.trim() && email.trim() && apiKey.trim();

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/gorgias/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain: subdomain.trim(),
          email: email.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(true);
        onConnected();
      } else {
        setError(data.error ?? "Connection failed. Check your credentials.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSubdomain("");
    setEmail("");
    setApiKey("");
    setError(null);
    setSuccess(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Connect Gorgias"
      primaryAction={
        success
          ? { content: "Done", onAction: handleClose }
          : {
              content: "Connect & Test",
              onAction: handleConnect,
              loading,
              disabled: !canSubmit,
            }
      }
      secondaryActions={
        success ? [] : [{ content: "Cancel", onAction: handleClose }]
      }
    >
      <Modal.Section>
        {success ? (
          <Banner title="Helpdesk connected" tone="success">
            <p>
              We&apos;ll attach customer communication automatically to your
              evidence packs.
            </p>
          </Banner>
        ) : (
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd" tone="subdued">
              Enter your Gorgias credentials. We&apos;ll encrypt them and test
              the connection.
            </Text>

            {error && (
              <Banner title="Connection failed" tone="critical">
                <p>{error}</p>
              </Banner>
            )}

            <FormLayout>
              <TextField
                label="Subdomain"
                value={subdomain}
                onChange={setSubdomain}
                placeholder="yourcompany"
                suffix=".gorgias.com"
                autoComplete="off"
              />
              <TextField
                label="Email"
                value={email}
                onChange={setEmail}
                type="email"
                placeholder="you@company.com"
                autoComplete="off"
              />
              <TextField
                label="API Key"
                value={apiKey}
                onChange={setApiKey}
                type="password"
                placeholder="Your Gorgias API key"
                autoComplete="off"
              />
            </FormLayout>

            <Text as="p" variant="bodySm" tone="subdued">
              Find your API key in Gorgias → Settings → REST API. Credentials
              are encrypted with AES-256-GCM before storage.
            </Text>
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

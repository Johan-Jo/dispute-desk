"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BlockStack,
  Text,
  InlineGrid,
  Card,
  InlineStack,
  Badge,
  Button,
  Icon,
  Banner,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  AlertTriangleIcon,
} from "@shopify/polaris-icons";
import type { IntegrationRow, EvidenceFileRow } from "@/lib/setup/types";
import { ConnectGorgiasModal } from "../modals/ConnectGorgiasModal";
import { UploadSampleFilesModal } from "../modals/UploadSampleFilesModal";
import { ComingSoonModal } from "../modals/ComingSoonModal";

interface EvidenceSourcesStepProps {
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

type ComingSoonTarget = "email" | "warehouse" | null;

export function EvidenceSourcesStep({ onSaveRef }: EvidenceSourcesStepProps) {
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [sampleFiles, setSampleFiles] = useState<EvidenceFileRow[]>([]);
  const [gorgiasModalOpen, setGorgiasModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [comingSoonTarget, setComingSoonTarget] = useState<ComingSoonTarget>(null);
  const [retesting, setRetesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const gorgias = integrations.find((i) => i.type === "gorgias");
  const gorgiasConnected = gorgias?.status === "connected";
  const gorgiasNeedsAttention = gorgias?.status === "needs_attention";
  const hasSampleFiles = sampleFiles.length > 0;
  const canComplete = gorgiasConnected || hasSampleFiles;

  const fetchIntegrations = useCallback(async () => {
    const res = await fetch("/api/integrations/status");
    if (res.ok) {
      const data = await res.json();
      setIntegrations(data.integrations ?? []);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    const res = await fetch("/api/files/samples");
    if (res.ok) {
      const data = await res.json();
      setSampleFiles(data.files ?? []);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
    fetchFiles();
  }, [fetchIntegrations, fetchFiles]);

  useEffect(() => {
    onSaveRef.current = async () => {
      if (!canComplete) return false;
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: "evidence_sources",
          payload: {
            gorgiasConnected,
            sampleFilesCount: sampleFiles.length,
          },
        }),
      });
      return res.ok;
    };
  }, [onSaveRef, canComplete, gorgiasConnected, sampleFiles.length]);

  const handleRetest = async () => {
    setRetesting(true);
    try {
      await fetch("/api/integrations/gorgias/test", { method: "POST" });
      await fetchIntegrations();
    } finally {
      setRetesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch("/api/integrations/gorgias/disconnect", { method: "POST" });
      await fetchIntegrations();
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        Evidence Sources
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        Connect your tools to automatically gather evidence for disputes.
      </Text>

      {!canComplete && (
        <Banner tone="info">
          <p>
            Connect Gorgias or upload at least one sample file to complete this
            step. Shopify tracking is built-in but doesn&apos;t count alone.
          </p>
        </Banner>
      )}

      <InlineGrid columns={2} gap="400">
        {/* Tracking Carrier */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Tracking Carrier
              </Text>
              <Badge tone="success">Available</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Shopify Tracking (built-in)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Uses Shopify fulfillment tracking number and URL automatically.
            </Text>
          </BlockStack>
        </Card>

        {/* Helpdesk (Gorgias) */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Helpdesk
              </Text>
              {gorgiasConnected ? (
                <Badge tone="success">Connected</Badge>
              ) : gorgiasNeedsAttention ? (
                <Badge tone="warning">Needs attention</Badge>
              ) : (
                <Badge>Not connected</Badge>
              )}
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Gorgias — customer communication history
            </Text>

            {gorgiasNeedsAttention && gorgias?.meta && (
              <Banner tone="warning" title="Connection issue">
                <p>{(gorgias.meta as Record<string, string>).last_error ?? "Check credentials"}</p>
              </Banner>
            )}

            {gorgiasConnected || gorgiasNeedsAttention ? (
              <InlineStack gap="200">
                <Button
                  size="slim"
                  onClick={handleRetest}
                  loading={retesting}
                >
                  Re-test
                </Button>
                <Button
                  size="slim"
                  tone="critical"
                  onClick={handleDisconnect}
                  loading={disconnecting}
                >
                  Disconnect
                </Button>
              </InlineStack>
            ) : (
              <Button onClick={() => setGorgiasModalOpen(true)}>
                Connect Gorgias
              </Button>
            )}
          </BlockStack>
        </Card>

        {/* Email - Coming Soon */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Email
              </Text>
              <Badge tone="attention">Coming soon</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Gmail, Outlook — email correspondence
            </Text>
            <Button
              onClick={() => setComingSoonTarget("email")}
              disabled
            >
              Coming soon
            </Button>
          </BlockStack>
        </Card>

        {/* Warehouse/3PL - Coming Soon */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">
                Warehouse / 3PL
              </Text>
              <Badge tone="attention">Coming soon</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              ShipBob, Flexport — fulfillment data
            </Text>
            <Button
              onClick={() => setComingSoonTarget("warehouse")}
              disabled
            >
              Coming soon
            </Button>
          </BlockStack>
        </Card>
      </InlineGrid>

      {/* Upload Sample Files */}
      <Card>
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              Sample Evidence Files
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {hasSampleFiles
                ? `${sampleFiles.length} file${sampleFiles.length !== 1 ? "s" : ""} uploaded`
                : "Upload sample files to help DisputeDesk understand your evidence format"}
            </Text>
          </BlockStack>
          <Button onClick={() => setUploadModalOpen(true)}>
            {hasSampleFiles ? "Manage files" : "Upload sample files"}
          </Button>
        </InlineStack>
      </Card>

      {/* Modals */}
      <ConnectGorgiasModal
        open={gorgiasModalOpen}
        onClose={() => setGorgiasModalOpen(false)}
        onConnected={() => {
          setGorgiasModalOpen(false);
          fetchIntegrations();
        }}
      />

      <UploadSampleFilesModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onFilesChanged={fetchFiles}
      />

      <ComingSoonModal
        open={comingSoonTarget === "email"}
        title="Email Integration"
        description="Connect Gmail or Outlook to automatically pull customer email correspondence into your evidence packs."
        onClose={() => setComingSoonTarget(null)}
      />

      <ComingSoonModal
        open={comingSoonTarget === "warehouse"}
        title="Warehouse / 3PL Integration"
        description="Connect ShipBob, Flexport, or other 3PLs to automatically include fulfillment and warehouse data in evidence packs."
        onClose={() => setComingSoonTarget(null)}
      />
    </BlockStack>
  );
}

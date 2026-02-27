"use client";

import { Modal, BlockStack, Text, Banner } from "@shopify/polaris";

interface ComingSoonModalProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
}

export function ComingSoonModal({
  open,
  title,
  description,
  onClose,
}: ComingSoonModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      primaryAction={{ content: "Got it", onAction: onClose }}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Banner tone="info">
            <p>This integration is coming soon.</p>
          </Banner>
          <Text as="p" variant="bodyMd" tone="subdued">
            {description}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            We&apos;ll notify you when this feature becomes available.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { Modal, ChoiceList, BlockStack, Text } from "@shopify/polaris";

interface SkipReasonModalProps {
  open: boolean;
  stepTitle: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

const REASONS = [
  { label: "I'll do it later", value: "do_later" },
  { label: "Not relevant to my business", value: "not_relevant" },
  { label: "I need help with this", value: "need_help" },
];

export function SkipReasonModal({
  open,
  stepTitle,
  onClose,
  onConfirm,
}: SkipReasonModalProps) {
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Skip "${stepTitle}"?`}
      primaryAction={{
        content: "Skip this step",
        onAction: () => {
          if (selected[0]) onConfirm(selected[0]);
        },
        disabled: selected.length === 0,
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd" tone="subdued">
            You can always come back and complete this step later. Please let us
            know why you&apos;re skipping so we can improve.
          </Text>
          <ChoiceList
            title="Reason"
            titleHidden
            choices={REASONS}
            selected={selected}
            onChange={setSelected}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

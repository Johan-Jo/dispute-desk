"use client";

import { useState, useCallback, forwardRef } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Icon,
  Collapsible,
  DropZone,
  Banner,
  Spinner,
} from "@shopify/polaris";
import {
  XCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import styles from "@/app/(embedded)/app/packs/[packId]/pack-detail.module.css";

export interface ChecklistItemUI {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
  collectable: boolean;
  unavailableReason?: string;
}

interface EvidenceItemRowProps {
  item: ChecklistItemUI;
  variant: "required" | "recommended";
  whyText: string;
  onUpload: (field: string, files: File[]) => Promise<void>;
  isUploading: boolean;
  errorMessage?: string;
  autoExpand?: boolean;
  highlighted?: boolean;
  readOnly?: boolean;
}

export const EvidenceItemRow = forwardRef<HTMLDivElement, EvidenceItemRowProps>(
  function EvidenceItemRow(
    {
      item,
      variant,
      whyText,
      onUpload,
      isUploading,
      errorMessage,
      autoExpand = false,
      highlighted = false,
      readOnly = false,
    },
    ref,
  ) {
    const [expanded, setExpanded] = useState(autoExpand);
    const dropZoneId = `upload-${item.field}`;

    const handleDrop = useCallback(
      async (_files: File[], accepted: File[]) => {
        if (accepted.length === 0) return;
        setExpanded(false);
        await onUpload(item.field, accepted);
      },
      [item.field, onUpload],
    );

    const rowClass =
      variant === "required"
        ? styles.evidenceRowRequired
        : styles.evidenceRowRecommended;

    return (
      <div
        ref={ref}
        className={`${rowClass} ${highlighted ? styles.highlighted : ""}`}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="start" wrap>
            <InlineStack gap="200" blockAlign="center" wrap>
              <Icon
                source={
                  variant === "required" ? XCircleIcon : AlertTriangleIcon
                }
                tone={variant === "required" ? "critical" : "caution"}
              />
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {item.label}
              </Text>
              <Badge tone={variant === "required" ? "critical" : "attention"}>
                {variant === "required" ? "Required" : "Recommended"}
              </Badge>
            </InlineStack>

            {!readOnly && !isUploading && (
              <Button
                size="slim"
                onClick={() => setExpanded((v) => !v)}
              >
                {errorMessage ? "Retry upload" : "Upload proof"}
              </Button>
            )}
            {isUploading && <Spinner size="small" />}
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            {whyText}
          </Text>

          {errorMessage && (
            <Banner tone="critical" hideIcon>
              <Text as="p" variant="bodySm">
                {errorMessage}
              </Text>
            </Banner>
          )}

          {!readOnly && (
            <Collapsible open={expanded} id={dropZoneId}>
              <div className={styles.inlineUploadZone}>
                <DropZone
                  onDrop={handleDrop}
                  allowMultiple={false}
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
                  variableHeight
                >
                  <DropZone.FileUpload actionHint="Drop a file or click to upload" />
                </DropZone>
              </div>
            </Collapsible>
          )}
        </BlockStack>
      </div>
    );
  },
);

/* Already-included item row (compact, no upload) */
interface IncludedItemRowProps {
  label: string;
  sourceLabel: string;
  timestamp?: string;
  canReplace?: boolean;
  onReplace?: (files: File[]) => Promise<void>;
  isReplacing?: boolean;
}

export function IncludedItemRow({
  label,
  sourceLabel,
  timestamp,
  canReplace = false,
  onReplace,
  isReplacing = false,
}: IncludedItemRowProps) {
  const [showUploader, setShowUploader] = useState(false);

  const handleDrop = useCallback(
    async (_files: File[], accepted: File[]) => {
      if (accepted.length === 0 || !onReplace) return;
      setShowUploader(false);
      await onReplace(accepted);
    },
    [onReplace],
  );

  return (
    <div className={styles.evidenceRowIncluded}>
      <BlockStack gap="100">
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Icon source={CheckCircleIcon} tone="success" />
            <Text as="span" variant="bodyMd">
              {label}
            </Text>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">
              {timestamp ?? sourceLabel}
            </Text>
            {canReplace && !isReplacing && (
              <Button
                size="slim"
                variant="plain"
                onClick={() => setShowUploader((v) => !v)}
              >
                Replace file
              </Button>
            )}
            {isReplacing && <Spinner size="small" />}
          </InlineStack>
        </InlineStack>

        {canReplace && (
          <Collapsible open={showUploader} id={`replace-${label}`}>
            <div className={styles.inlineUploadZone}>
              <DropZone
                onDrop={handleDrop}
                allowMultiple={false}
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
                variableHeight
              >
                <DropZone.FileUpload actionHint="Drop a file to replace" />
              </DropZone>
            </div>
          </Collapsible>
        )}
      </BlockStack>
    </div>
  );
}

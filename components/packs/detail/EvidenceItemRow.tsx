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
  Popover,
  ActionList,
} from "@shopify/polaris";
import {
  XCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  MinusCircleIcon,
} from "@shopify/polaris-icons";
import type {
  ChecklistItemV2,
  WaiveReason,
} from "@/lib/types/evidenceItem";
import styles from "@/app/(embedded)/app/packs/[packId]/pack-detail.module.css";

/** Legacy UI type — kept for backward compat shim in page.tsx. */
export interface ChecklistItemUI {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
  collectable: boolean;
  unavailableReason?: string;
}

/* ── Waive reason labels ── */

const WAIVE_REASON_LABELS: Record<WaiveReason, string> = {
  not_applicable: "Not applicable to this dispute",
  evidence_unavailable: "I can\u2019t get this evidence",
  already_in_shopify: "Already submitted separately",
  merchant_accepts_risk: "I understand the risk",
  other: "Other reason",
};

/* ── EvidenceItemRow ── */

interface EvidenceItemRowProps {
  item: ChecklistItemV2;
  whyText: string;
  onUpload: (field: string, files: File[]) => Promise<void>;
  isUploading: boolean;
  errorMessage?: string;
  autoExpand?: boolean;
  highlighted?: boolean;
  readOnly?: boolean;
  onWaive?: (field: string, reason: WaiveReason, note?: string) => void;
}

export const EvidenceItemRow = forwardRef<HTMLDivElement, EvidenceItemRowProps>(
  function EvidenceItemRow(
    {
      item,
      whyText,
      onUpload,
      isUploading,
      errorMessage,
      autoExpand = false,
      highlighted = false,
      readOnly = false,
      onWaive,
    },
    ref,
  ) {
    const [expanded, setExpanded] = useState(autoExpand);
    const [waiveOpen, setWaiveOpen] = useState(false);
    const dropZoneId = `upload-${item.field}`;

    const isCritical = item.priority === "critical";
    const rowClass = isCritical
      ? styles.evidenceRowRequired
      : item.priority === "recommended"
        ? styles.evidenceRowRecommended
        : styles.evidenceRowRecommended;

    const badgeTone = item.blocking
      ? "critical" as const
      : isCritical
        ? "attention" as const
        : undefined;
    const badgeLabel = item.blocking
      ? "Required"
      : isCritical
        ? "High impact"
        : "Recommended";

    const iconSource = item.blocking ? XCircleIcon : isCritical ? AlertTriangleIcon : AlertTriangleIcon;
    const iconTone = item.blocking ? "critical" as const : isCritical ? "caution" as const : "subdued" as const;

    const handleDrop = useCallback(
      async (_files: File[], accepted: File[]) => {
        if (accepted.length === 0) return;
        setExpanded(false);
        await onUpload(item.field, accepted);
      },
      [item.field, onUpload],
    );

    const waiveActions = Object.entries(WAIVE_REASON_LABELS).map(
      ([reason, label]) => ({
        content: label,
        onAction: () => {
          setWaiveOpen(false);
          onWaive?.(item.field, reason as WaiveReason);
        },
      }),
    );

    return (
      <div
        ref={ref}
        className={`${rowClass} ${highlighted ? styles.highlighted : ""}`}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="start" wrap>
            <InlineStack gap="200" blockAlign="center" wrap>
              <Icon source={iconSource} tone={iconTone} />
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {item.label}
              </Text>
              <Badge tone={badgeTone}>{badgeLabel}</Badge>
            </InlineStack>

            {!readOnly && !isUploading && (
              <InlineStack gap="200">
                <Button size="slim" onClick={() => setExpanded((v) => !v)}>
                  {errorMessage ? "Retry upload" : "Upload proof"}
                </Button>
                {onWaive && (
                  <Popover
                    active={waiveOpen}
                    activator={
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => setWaiveOpen((v) => !v)}
                      >
                        Continue without this
                      </Button>
                    }
                    onClose={() => setWaiveOpen(false)}
                  >
                    <ActionList items={waiveActions} />
                  </Popover>
                )}
              </InlineStack>
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

/* ── Waived item row ── */

interface WaivedItemRowProps {
  item: ChecklistItemV2;
  onUnwaive?: (field: string) => void;
}

export function WaivedItemRow({ item, onUnwaive }: WaivedItemRowProps) {
  return (
    <div className={styles.evidenceRowIncluded}>
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="200" blockAlign="center">
          <Icon source={MinusCircleIcon} tone="subdued" />
          <Text as="span" variant="bodyMd" tone="subdued">
            {item.label}
          </Text>
          <Badge>
            {item.waiveReason
              ? WAIVE_REASON_LABELS[item.waiveReason] ?? "Waived"
              : "Waived"}
          </Badge>
        </InlineStack>
        {onUnwaive && (
          <Button
            size="slim"
            variant="plain"
            onClick={() => onUnwaive(item.field)}
          >
            Undo
          </Button>
        )}
      </InlineStack>
    </div>
  );
}

/* ── Already-included item row (compact, no upload) ── */

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

/**
 * MissingOrWeakSection — Section 3 of EvidenceTab.
 *
 * Lists only items that are missing or incomplete. Each row is a
 * punch-list entry, never framed as a failure. Empty list → section
 * collapses (returns null).
 *
 * Inline merchant actions:
 *   - Upload evidence       → actions.uploadEvidence(field, files)
 *   - Mark as not applicable → actions.waiveItem(field, reason)
 *
 * Both callbacks are optional; when omitted, the row renders the
 * action instruction as plain text. Upload uses a hidden <input
 * type="file"> so the affordance stays a single Polaris Button —
 * no DropZone, no drag-and-drop choreography.
 */

"use client";

import { useRef, useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Modal,
  Select,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { SHOPIFY_DISPUTE_EVIDENCE_FILE_ACCEPT_ATTR } from "@/lib/uploads/shopifyDisputeEvidenceFileConstraints";
import type { MissingItemViewModel } from "../useEvidenceSections";
import type { WaiveReason } from "../../workspace-components/types";

const WAIVE_REASONS: WaiveReason[] = [
  "not_applicable",
  "evidence_unavailable",
  "already_in_shopify",
  "merchant_accepts_risk",
  "other",
];

interface RowProps {
  item: MissingItemViewModel;
  t: ReturnType<typeof useTranslations>;
  tActions: ReturnType<typeof useTranslations>;
  uploading: boolean;
  onUpload?: (field: string, files: File[]) => void;
  onWaiveClick?: (field: string) => void;
}

function MissingRow({ item, t, tActions, uploading, onUpload, onWaiveClick }: RowProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <BlockStack gap="100">
      <InlineStack gap="200" blockAlign="center">
        <Text as="h4" variant="headingSm">
          {item.title}
        </Text>
        <Badge tone={item.required ? "critical" : "info"}>
          {item.required ? t("required") : t("optional")}
        </Badge>
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">
        {item.whyItMatters}
      </Text>

      {(onUpload || onWaiveClick) ? (
        <InlineStack gap="200">
          {onUpload ? (
            <>
              {/* Hidden native input — single, contextual file picker.
                  No DropZone, no inline preview state. */}
              <input
                ref={fileInputRef}
                type="file"
                accept={SHOPIFY_DISPUTE_EVIDENCE_FILE_ACCEPT_ATTR}
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) onUpload(item.field, files);
                  e.target.value = ""; // allow same-file re-selection
                }}
              />
              <Button
                size="slim"
                onClick={() => fileInputRef.current?.click()}
                loading={uploading}
                disabled={uploading}
              >
                {uploading ? tActions("uploading") : tActions("upload")}
              </Button>
            </>
          ) : null}
          {onWaiveClick ? (
            <Button
              variant="plain"
              size="slim"
              onClick={() => onWaiveClick(item.field)}
            >
              {tActions("markNotApplicable")}
            </Button>
          ) : null}
        </InlineStack>
      ) : item.actionInstruction ? (
        // Read-only fallback when no callbacks are wired.
        <Text as="p" variant="bodySm">
          {item.actionInstruction}
        </Text>
      ) : null}
    </BlockStack>
  );
}

interface Props {
  items: MissingItemViewModel[];
  uploadingField?: string | null;
  onUpload?: (field: string, files: File[]) => void;
  onWaive?: (field: string, reason: WaiveReason) => void;
}

export function MissingOrWeakSection({
  items,
  uploadingField,
  onUpload,
  onWaive,
}: Props) {
  const t = useTranslations("disputes.evidenceTab.sections.missing");
  const tActions = useTranslations("disputes.evidenceTab.sections.missing.actions");

  // Single waive modal at the section level — opens with a target field
  // captured in state so we don't render N modals (one per row).
  const [waiveTarget, setWaiveTarget] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState<WaiveReason>("not_applicable");

  if (items.length === 0) return null;

  const handleWaiveConfirm = () => {
    if (waiveTarget && onWaive) {
      onWaive(waiveTarget, waiveReason);
    }
    setWaiveTarget(null);
    setWaiveReason("not_applicable");
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("title")}
        </Text>

        {items.map((item) => (
          <MissingRow
            key={item.id}
            item={item}
            t={t}
            tActions={tActions}
            uploading={uploadingField === item.field}
            onUpload={onUpload}
            onWaiveClick={onWaive ? (field) => setWaiveTarget(field) : undefined}
          />
        ))}
      </BlockStack>

      {onWaive ? (
        <Modal
          open={waiveTarget !== null}
          onClose={() => setWaiveTarget(null)}
          title={tActions("waiveTitle")}
          primaryAction={{
            content: tActions("waiveConfirm"),
            onAction: handleWaiveConfirm,
          }}
          secondaryActions={[
            {
              content: tActions("waiveCancel"),
              onAction: () => setWaiveTarget(null),
            },
          ]}
        >
          <Modal.Section>
            <Select
              label={tActions("waiveTitle")}
              labelHidden
              options={WAIVE_REASONS.map((r) => ({
                label: tActions(`waiveReason.${r}`),
                value: r,
              }))}
              value={waiveReason}
              onChange={(v) => setWaiveReason(v as WaiveReason)}
            />
          </Modal.Section>
        </Modal>
      ) : null}
    </Card>
  );
}

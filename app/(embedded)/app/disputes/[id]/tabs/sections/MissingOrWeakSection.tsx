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
 *
 * Focus highlight (Phase 6 follow-up):
 *   When the merchant clicks "Add this evidence" on the Overview
 *   tab, `actions.navigateToEvidence(field)` switches to this tab
 *   and stores `field` in `clientState.focusField`. This component
 *   reads `focusField` (passed in by EvidenceTab) and:
 *     1. Scrolls the matching row into view.
 *     2. Pulses a soft yellow background (~3 s) so the merchant
 *        immediately sees which row their click sent them to —
 *        critical when more than one row is missing.
 *     3. Calls `onFocusCleared` after the animation so the focus
 *        state doesn't restick on subsequent renders.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Modal,
  Select,
  Divider,
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

/** CSS keyframes for the focus pulse — three soft yellow pulses fading
 *  to transparent over ~3 s. Defined once via a module-level <style>
 *  injected at first render so the animation name can be referenced
 *  by inline style on the row. Idempotent — re-injection is harmless. */
const FOCUS_KEYFRAMES = `
@keyframes ddFocusPulse {
  0%   { background-color: #FEF3C7; }
  20%  { background-color: rgba(254, 243, 199, 0.4); }
  40%  { background-color: #FEF3C7; }
  60%  { background-color: rgba(254, 243, 199, 0.4); }
  80%  { background-color: #FEF3C7; }
  100% { background-color: transparent; }
}`;

const FOCUS_PULSE_DURATION_MS = 3000;

interface RowProps {
  item: MissingItemViewModel;
  t: ReturnType<typeof useTranslations>;
  tActions: ReturnType<typeof useTranslations>;
  showPerRowBadge: boolean;
  uploading: boolean;
  highlighted: boolean;
  /** Resubmission Window: when the dispute is `submitted_confirmed`,
   *  Shopify has forwarded evidence to the bank and additional uploads
   *  are useless. The button is rendered disabled so the merchant has
   *  a clear visual signal alongside the page-level closed banner. */
  uploadsDisabled?: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onUpload?: (field: string, files: File[]) => void;
  onWaiveClick?: (field: string) => void;
}

function MissingRow({
  item,
  t,
  tActions,
  showPerRowBadge,
  uploading,
  highlighted,
  uploadsDisabled,
  rowRef,
  onUpload,
  onWaiveClick,
}: RowProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const actions =
    onUpload || onWaiveClick ? (
      <BlockStack gap="150" align="end" inlineAlign="end">
        {onUpload ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={SHOPIFY_DISPUTE_EVIDENCE_FILE_ACCEPT_ATTR}
              style={{ display: "none" }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) onUpload(item.field, files);
                e.target.value = "";
              }}
            />
            <Button
              size="slim"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
              disabled={uploading || uploadsDisabled}
            >
              {uploading ? tActions("uploading") : tActions("upload")}
            </Button>
          </>
        ) : null}
        {onWaiveClick ? (
          <Button
            variant="tertiary"
            size="micro"
            onClick={() => onWaiveClick(item.field)}
          >
            {tActions("markNotApplicable")}
          </Button>
        ) : null}
      </BlockStack>
    ) : null;

  return (
    <div
      ref={rowRef}
      style={{
        margin: "-8px -12px",
        padding: "8px 12px",
        borderRadius: 8,
        animation: highlighted
          ? `ddFocusPulse ${FOCUS_PULSE_DURATION_MS}ms ease-out 1`
          : undefined,
      }}
    >
      <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
        <BlockStack gap="050">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h4" variant="headingSm">
              {item.title}
            </Text>
            {showPerRowBadge && item.required ? (
              <Badge tone="critical">{t("required")}</Badge>
            ) : null}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {item.whyItMatters}
          </Text>
          {!actions && item.actionInstruction ? (
            <Text as="p" variant="bodySm">
              {item.actionInstruction}
            </Text>
          ) : null}
        </BlockStack>
        {actions}
      </InlineStack>
    </div>
  );
}

interface Props {
  items: MissingItemViewModel[];
  uploadingField?: string | null;
  /** Field key the merchant just navigated to (from
   *  `clientState.focusField`). When set and matching one of `items`,
   *  the row scrolls into view and pulses yellow for ~3 s. */
  focusField?: string | null;
  /** Callback fired after the highlight animation completes so the
   *  parent can reset `clientState.focusField` to null. Without this
   *  the highlight would re-fire on every subsequent render. */
  onFocusCleared?: () => void;
  /** Resubmission Window: when true, all upload buttons render in a
   *  disabled state. Mirrors the server-side 409 WINDOW_CLOSED guard
   *  for clear UI signal alongside the page-level closed banner. */
  uploadsDisabled?: boolean;
  onUpload?: (field: string, files: File[]) => void;
  onWaive?: (field: string, reason: WaiveReason) => void;
}

export function MissingOrWeakSection({
  items,
  uploadingField,
  focusField,
  onFocusCleared,
  uploadsDisabled,
  onUpload,
  onWaive,
}: Props) {
  const t = useTranslations("disputes.evidenceTab.sections.missing");
  const tActions = useTranslations("disputes.evidenceTab.sections.missing.actions");

  // Single waive modal at the section level — opens with a target field
  // captured in state so we don't render N modals (one per row).
  const [waiveTarget, setWaiveTarget] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState<WaiveReason>("not_applicable");

  // Currently-highlighted field — derived from `focusField` but held
  // locally so the animation can finish even after the parent clears
  // `focusField` via `onFocusCleared`.
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Scroll-into-view + pulse trigger. Runs whenever `focusField`
  // resolves to a row that's actually present in the current `items`
  // list. The cleanup cancels the timeout if the component unmounts
  // or `focusField` changes again before the pulse finishes.
  useEffect(() => {
    if (!focusField) return;
    const match = items.find((i) => i.field === focusField);
    if (!match) return;

    const el = rowRefs.current[match.field];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setHighlightedField(match.field);

    const timer = window.setTimeout(() => {
      setHighlightedField(null);
      onFocusCleared?.();
    }, FOCUS_PULSE_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [focusField, items, onFocusCleared]);

  if (items.length === 0) return null;

  const handleWaiveConfirm = () => {
    if (waiveTarget && onWaive) {
      onWaive(waiveTarget, waiveReason);
    }
    setWaiveTarget(null);
    setWaiveReason("not_applicable");
  };

  const requiredCount = items.filter((i) => i.required).length;
  const optionalCount = items.length - requiredCount;

  return (
    <Card>
      <style>{FOCUS_KEYFRAMES}</style>

      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("description")}
          </Text>
          <InlineStack gap="200">
            {requiredCount > 0 ? (
              <Badge tone="critical">
                {`${requiredCount} ${t("required")}`}
              </Badge>
            ) : null}
            {optionalCount > 0 ? (
              <Badge tone="info">
                {`${optionalCount} ${t("optional")}`}
              </Badge>
            ) : null}
          </InlineStack>
        </BlockStack>

        <BlockStack gap="0">
          {items.map((item, idx) => (
            <BlockStack gap="0" key={item.id}>
              {idx > 0 ? <Divider /> : null}
              <div style={{ padding: "12px 0" }}>
                <MissingRow
                  item={item}
                  t={t}
                  tActions={tActions}
                  showPerRowBadge
                  uploading={uploadingField === item.field}
                  highlighted={highlightedField === item.field}
                  uploadsDisabled={uploadsDisabled}
                  rowRef={(el) => {
                    rowRefs.current[item.field] = el;
                  }}
                  onUpload={onUpload}
                  onWaiveClick={
                    onWaive ? (field) => setWaiveTarget(field) : undefined
                  }
                />
              </div>
            </BlockStack>
          ))}
        </BlockStack>

        <Text as="p" variant="bodyXs" tone="subdued">
          {tActions("fileHint")}
        </Text>
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

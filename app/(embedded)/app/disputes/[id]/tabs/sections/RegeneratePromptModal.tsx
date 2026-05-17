/**
 * RegeneratePromptModal — Resubmission Window confirmation.
 *
 * Opens after a successful upload to the Evidence tab when the pack
 * was already saved to Shopify but Shopify hasn't yet forwarded to the
 * issuing bank (`submissionState === "saved_to_shopify"`). Asks the
 * merchant whether to regenerate the full defence package; on confirm
 * the workspace hook calls POST /api/packs/:packId/regenerate which
 * re-enqueues the existing build_pack pipeline.
 *
 * Copy adapts to the dispute's automation mode:
 *   - auto:    "saved to Shopify and replace the current package"
 *   - review:  "prepared for your review before it is saved to Shopify"
 *   - null:    neutral fallback ("follow this dispute's current
 *              submission settings")
 *
 * Errors:
 *   - WINDOW_CLOSED (server flips state between modal-open and confirm)
 *     is handled by the workspace hook by closing this modal silently
 *     and letting the page-level window-closed banner take over. It
 *     never reaches `error` here.
 *   - Any other server error is surfaced inside the modal as a
 *     Polaris critical Banner; the modal stays open so the merchant
 *     can retry or dismiss.
 */

"use client";

import { Modal, Banner, BlockStack, Text } from "@shopify/polaris";
import { useTranslations } from "next-intl";

export type RegenerateModalMode = "auto" | "review" | null;

export interface RegeneratePromptModalProps {
  open: boolean;
  mode: RegenerateModalMode;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RegeneratePromptModal({
  open,
  mode,
  submitting,
  error,
  onConfirm,
  onCancel,
}: RegeneratePromptModalProps) {
  const t = useTranslations("disputes.evidenceTab.regenerateModal");

  const bodyKey =
    mode === "auto"
      ? "bodyAuto"
      : mode === "review"
        ? "bodyReview"
        : "bodyNeutral";

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("title")}
      primaryAction={{
        content: t("primaryAction"),
        onAction: onConfirm,
        loading: submitting,
        disabled: submitting,
      }}
      secondaryActions={[
        {
          content: t("secondaryAction"),
          onAction: onCancel,
          disabled: submitting,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {error ? (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          ) : null}
          <Text as="p">{t(bodyKey)}</Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

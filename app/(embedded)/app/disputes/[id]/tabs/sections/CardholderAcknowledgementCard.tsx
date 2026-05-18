/**
 * CardholderAcknowledgementCard — Evidence tab merchant-input card.
 *
 * Lets the merchant paste an email/chat/message from the cardholder
 * acknowledging the purchase, then check a confirmation box. The
 * confirmation is the discriminator that elevates customer_communication
 * from supporting → strong via the canonical categorizer's
 * `payload.customerConfirmsOrder === true` branch.
 *
 * Submit triggers a server-side build_pack rebuild. For
 * `SAVED_TO_SHOPIFY` disputes the existing RegeneratePromptModal opens
 * automatically so the merchant can push the new pack to Shopify.
 *
 * Hide gates:
 *   - dispute is closed (final outcome posted)
 *   - dispute is window-closed (already forwarded to bank)
 *   - customer_communication is already strong (the merchant already
 *     uploaded a confirming message via the regular upload route)
 *
 * Otherwise renders. Default-collapsed; expands inline when the
 * merchant clicks "Add cardholder acknowledgement".
 */

"use client";

import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const MAX_LEN = 8000;
const MIN_LEN = 20;

interface Props {
  workspace: Workspace;
}

export function CardholderAcknowledgementCard({ workspace }: Props) {
  const t = useTranslations("disputes.evidenceTab.cardholderAck");
  const { data, derived, actions } = workspace;

  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  // Hide for terminal / window-closed states. The merchant cannot
  // change anything bank-facing once Shopify forwards.
  const submissionState = data?.dispute?.submissionState ?? null;
  const isWindowClosed = submissionState === "submitted_confirmed";
  const hasFinalOutcome = Boolean(data?.dispute?.finalOutcome);
  if (isWindowClosed || hasFinalOutcome) return null;

  // If customer_communication already resolves to a strong/positive
  // bank-facing row, the merchant has already provided this evidence —
  // no need to surface the input again.
  const ccRow = data?.evidenceLineItems?.find((li) => li.field === "customer_communication");
  if (ccRow?.usedAsPositiveBankEvidence) return null;
  // Build state isn't a hard hide, but disable the submit when a build
  // is already running so we don't queue two on top of each other.
  const buildInFlight = derived.isBuilding || derived.isRegenerating;

  const trimmed = text.trim();
  const canSubmit = confirmed && trimmed.length >= MIN_LEN && !submitting && !buildInFlight;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await actions.submitCardholderAcknowledgement(trimmed);
      if (!result.ok) {
        if (result.code === "WINDOW_CLOSED") {
          setErrorMessage(t("errorWindowClosed"));
        } else if (result.code === "CONFIRMATION_REQUIRED") {
          setErrorMessage(t("errorConfirmationRequired"));
        } else if (result.code === "TEXT_TOO_SHORT") {
          setErrorMessage(t("errorTooShort"));
        } else {
          setErrorMessage(t("errorGeneric", { code: result.code ?? "unknown" }));
        }
        return;
      }
      setSuccessOpen(true);
      setText("");
      setConfirmed(false);
      setExpanded(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h3" variant="headingSm">
            {t("title")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {t("subtitle")}
          </Text>
        </BlockStack>

        {successOpen ? (
          <Banner tone="success" title={t("successTitle")} onDismiss={() => setSuccessOpen(false)}>
            <p>{t("successBody")}</p>
          </Banner>
        ) : null}

        {errorMessage ? (
          <Banner tone="warning" onDismiss={() => setErrorMessage(null)}>
            <p>{errorMessage}</p>
          </Banner>
        ) : null}

        {!expanded ? (
          <InlineStack align="start">
            <Button onClick={() => setExpanded(true)}>{t("title")}</Button>
          </InlineStack>
        ) : (
          <BlockStack gap="300">
            <TextField
              label={t("textareaLabel")}
              value={text}
              onChange={(v) => setText(v)}
              multiline={6}
              maxLength={MAX_LEN}
              autoComplete="off"
              placeholder={t("textareaPlaceholder")}
              helpText={t("textareaHint")}
              disabled={submitting}
            />
            <Text as="p" variant="bodyXs" tone="subdued">
              {t("charCount", { count: text.length, max: MAX_LEN })}
            </Text>
            <Checkbox
              label={t("checkboxLabel")}
              checked={confirmed}
              onChange={(v) => setConfirmed(v)}
              disabled={submitting}
              helpText={t("checkboxHelper")}
            />
            <InlineStack gap="200" align="end">
              <Button
                onClick={() => {
                  setExpanded(false);
                  setText("");
                  setConfirmed(false);
                  setErrorMessage(null);
                }}
                disabled={submitting}
              >
                {`Cancel`}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void handleSubmit();
                }}
                loading={submitting}
                disabled={!canSubmit}
              >
                {submitting ? t("submitting") : t("submit")}
              </Button>
            </InlineStack>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

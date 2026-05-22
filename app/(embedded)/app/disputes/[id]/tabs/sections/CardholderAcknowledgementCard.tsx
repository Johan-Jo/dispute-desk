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

  // Collapsed state: promoted CTA card matching the redesign — tinted
  // blue background, rounded icon, eyebrow that frames the action as
  // "suggested next step". The expanded state intentionally drops the
  // CTA chrome and renders a plain Card so the textarea, checkbox, and
  // submit row read like a regular form, not a glossy promo.
  if (!expanded) {
    return (
      <>
        {successOpen ? (
          <Banner
            tone="success"
            title={t("successTitle")}
            onDismiss={() => setSuccessOpen(false)}
          >
            <p>{t("successBody")}</p>
          </Banner>
        ) : null}
        <div
          role="region"
          aria-label={t("ctaEyebrow")}
          style={{
            background: "linear-gradient(180deg, #EFF6FF 0%, #F5F9FF 100%)",
            border: "1px solid #BFDBFE",
            borderRadius: 12,
            padding: 20,
            display: "grid",
            gridTemplateColumns: "44px 1fr",
            gap: 16,
            boxShadow: "0 1px 0 rgba(15, 56, 154, 0.04)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#DBEAFE",
              color: "#1D4ED8",
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{ width: 22, height: 22 }}
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <div>
            <p
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontWeight: 600,
                color: "#1D4ED8",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                margin: "0 0 4px",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#1D4ED8",
                }}
              />
              {t("ctaEyebrow")}
            </p>
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#1E3A8A",
                margin: "0 0 6px",
                lineHeight: 1.4,
              }}
            >
              {t("title")}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: "#1E40AF",
                margin: "0 0 14px",
                lineHeight: 1.55,
              }}
            >
              {t("subtitle")}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  background: "#1D4ED8",
                  color: "#fff",
                  border: "1px solid transparent",
                  boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.18)",
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                }}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                  style={{ width: 14, height: 14 }}
                >
                  <path d="M10 4a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 10 4Z" />
                </svg>
                {t("ctaButton")}
              </button>
              <span style={{ fontSize: 12, color: "#4561B0" }}>{t("ctaMeta")}</span>
            </div>
          </div>
        </div>
      </>
    );
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

        {errorMessage ? (
          <Banner tone="warning" onDismiss={() => setErrorMessage(null)}>
            <p>{errorMessage}</p>
          </Banner>
        ) : null}

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
      </BlockStack>
    </Card>
  );
}

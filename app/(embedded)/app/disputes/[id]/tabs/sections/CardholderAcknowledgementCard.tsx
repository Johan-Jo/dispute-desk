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

import { useEffect, useRef, useState } from "react";
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
import { useSearchParams } from "next/navigation";
import { canOfferCardholderAcknowledgement } from "@/lib/disputes/heldState";
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

  // Deep link `?section=cardholder-ack` (the held new-dispute email's
  // secondary CTA). WorkspaceShell switches to the Evidence tab; this
  // opens the form and scrolls to it, so the merchant lands on the input
  // rather than somewhere near it. Same shape as the `gorgias-comms`
  // deep link. Runs once — re-expanding after the merchant collapses it
  // would make the card impossible to dismiss.
  const searchParams = useSearchParams();
  const deepLinked = searchParams.get("section") === "cardholder-ack";
  const deepLinkApplied = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!deepLinked || deepLinkApplied.current) return;
    deepLinkApplied.current = true;
    setExpanded(true);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [deepLinked]);

  // Visibility is decided by `canOfferCardholderAcknowledgement`
  // (lib/disputes/heldState) — hides for terminal / window-closed
  // disputes, and once the merchant has provided cardholder
  // communication in ANY form.
  //
  // The gate uses `hasEvidence` (row status available/waived) rather than
  // `usedAsPositiveBankEvidence` deliberately: the categorizer may keep a
  // provided conversation at "supporting" when the discriminator
  // (`customerConfirmsOrder === true`) doesn't propagate, and the CTA then
  // kept re-appearing after the merchant had already done the work.
  //
  // It is shared, not local, because the Overview hero and the
  // new-dispute email now name this same action. A local copy would let
  // them invite an acknowledgement on a dispute where this card is
  // hidden — the exact failure mode of "add the product listing" on a
  // dispute with no product branch (prod 8f90a8f0).
  const ccRow = data?.evidenceLineItems?.find((li) => li.field === "customer_communication");
  const offerable = canOfferCardholderAcknowledgement({
    communicationHasEvidence: ccRow?.hasEvidence === true,
    submissionState: data?.dispute?.submissionState ?? null,
    finalOutcome: data?.dispute?.finalOutcome ?? null,
  });
  if (!offerable) return null;

  // Hide the whole card while a rebuild is in flight (after the
  // merchant just submitted an acknowledgement, OR while any other
  // workspace action is regenerating the pack). The consolidated
  // green "regenerating" banner upstream carries the status — keeping
  // the CTA visible at the same time would invite a second submission
  // and contradict the banner. Once the rebuild completes, either:
  //   - the new customer_communication line item resolves as positive
  //     bank evidence → the `ccRow?.usedAsPositiveBankEvidence` gate
  //     above keeps the card hidden, or
  //   - the merchant's input didn't qualify → the card re-appears so
  //     they can try again with a different message.
  const buildInFlight = derived.isBuilding || derived.isRegenerating;
  if (buildInFlight) return null;

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
      // Submission succeeded → the parent fetchAll() inside
      // submitCardholderAcknowledgement has already flipped the pack
      // into `rebuildPending` / `queued`, which makes
      // `derived.isRegenerating` true on the next render. The
      // buildInFlight gate at the top of the component will then
      // collapse this card entirely while the consolidated green
      // regenerating banner upstream carries the status. We still
      // reset local form state in case the card re-appears (e.g. the
      // text didn't elevate customer_communication to positive bank
      // evidence and the merchant wants to try again).
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
        <div
          ref={rootRef}
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
    );
  }

  return (
    <div ref={rootRef}>
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
    </div>
  );
}

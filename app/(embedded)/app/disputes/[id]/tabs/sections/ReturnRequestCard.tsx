/**
 * ReturnRequestCard — "Did this customer ask for a return or refund?"
 * (Fix C4b, docs/plans/mein-maison-status-and-no-return.plan.md).
 *
 * Shown only for a shop that takes returns outside Shopify (Settings →
 * Automation) and a reason family where the answer matters. Shopify's record
 * cannot tell whether the customer asked by email; only the merchant can.
 *
 * Two audiences, enforced server-side (orderSource + claim guards):
 *   - "did not ask" → one attributed sentence in the response, and the
 *     no-return fact counts toward the case strength again;
 *   - "asked" → the no-return fact is dropped from score and letter, and
 *     the answer is never shown to the bank.
 * An unanswered question never blocks a filing.
 *
 * Structure mirrors ParcelOutcomeCard: collapsed prompt, plain form.
 */

"use client";

import { useState } from "react";
import { Banner, BlockStack, Button, Card, InlineStack, Select, Text, TextField } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const ANSWERS = ["no_request_received", "request_received", "not_sure"] as const;
const MAX_NOTE = 2000;

export function ReturnRequestCard({ workspace }: { workspace: Workspace }) {
  const t = useTranslations("disputes.evidenceTab.returnRequest");
  const { data, derived, actions } = workspace;

  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rr = data?.returnRequest;
  if (!rr?.applies) return null;
  if (data?.dispute?.finalOutcome) return null;
  if (data?.dispute?.submissionState === "submitted_confirmed") return null;
  if (derived.isBuilding || derived.isRegenerating) return null;

  const saved = rr.answer;

  async function handleSubmit() {
    if (!answer || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await actions.submitReturnRequestConfirmation(answer, note.trim() || null);
      if (!result.ok) {
        setErrorMessage(
          result.code === "WINDOW_CLOSED" ? t("errorWindowClosed") : t("errorGeneric", { code: result.code ?? "unknown" }),
        );
        return;
      }
      setEditing(false);
      setAnswer("");
      setNote("");
    } finally {
      setSubmitting(false);
    }
  }

  if (saved && !editing) {
    return (
      <Card>
        <InlineStack align="space-between" blockAlign="center" gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              {t("title")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("answered", { answer: t(`answer.${saved.answer}`) })}
            </Text>
          </BlockStack>
          <Button onClick={() => setEditing(true)}>{t("change")}</Button>
        </InlineStack>
      </Card>
    );
  }

  return (
    <div data-testid="return-request-card">
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="caution" fontWeight="semibold">
              {t("ctaEyebrow")}
            </Text>
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

          <Select
            label={t("answerLabel")}
            helpText={t("answerHint")}
            options={[
              { label: t("choosePlaceholder"), value: "" },
              ...ANSWERS.map((a) => ({ label: t(`answer.${a}`), value: a })),
            ]}
            value={answer}
            onChange={setAnswer}
            disabled={submitting}
          />
          <TextField
            label={t("noteLabel")}
            helpText={t("noteHint")}
            value={note}
            onChange={setNote}
            multiline={2}
            maxLength={MAX_NOTE}
            autoComplete="off"
            disabled={submitting}
          />
          <InlineStack gap="200" align="end">
            <Button variant="primary" onClick={handleSubmit} disabled={!answer || submitting}>
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </div>
  );
}

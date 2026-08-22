/**
 * ParcelOutcomeCard — Evidence tab merchant-input card for a parcel the
 * carrier returned to sender.
 *
 * When a shipment comes back, the case loses the only thing that could
 * have won it on delivery: a proof of delivery, which can now never
 * exist. The returned-to-sender gate says so honestly (weak, never
 * auto-filed). What it cannot say is WHY the parcel came back — and that
 * is the one remaining fact worth arguing, because Klarna's merchant
 * rules treat a refused or uncollected delivery as *not* a valid return
 * or withdrawal, and ask merchants to state it in their response.
 *
 * Only the merchant knows. So we ask them, once, here.
 *
 * Two questions, two audiences:
 *   - **Why did it come back?** Bank-facing for `refused_delivery` and
 *     `not_collected`. `undeliverable_address` is recorded and never
 *     cited — an address that did not work is not an argument.
 *   - **What happened to it since?** NEVER bank-facing, under any answer.
 *     It exists so the merchant's own picture of the case is complete and
 *     so we can tell them plainly when conceding is the honest call. The
 *     split is enforced server-side, not here.
 *
 * Visibility is `canOfferParcelOutcome` (lib/disputes/heldState) — the
 * shared gate, so no other surface can invite an answer this card hides.
 *
 * Structure mirrors `CardholderAcknowledgementCard`: collapsed promo CTA,
 * expanded plain form, submit triggers a server-side rebuild and (inside
 * the resubmission window) the RegeneratePromptModal.
 */

"use client";

import { useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import {
  canOfferParcelOutcome,
  merchantAnsweredParcelOutcomeFromItems,
} from "@/lib/disputes/heldState";
import {
  buildDeliveryPresentation,
  resolveDeliveryReceipt,
} from "@/lib/argument/deliveryPresentation";
import type { useDisputeWorkspace } from "../../hooks/useDisputeWorkspace";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const MAX_NOTE = 2000;

const REASONS = [
  "refused_delivery",
  "not_collected",
  "undeliverable_address",
] as const;

const DISPOSITIONS = [
  "restocked_not_refunded",
  "still_held",
  "reshipped",
  "refunded",
] as const;

interface Props {
  workspace: Workspace;
}

export function ParcelOutcomeCard({ workspace }: Props) {
  const t = useTranslations("disputes.evidenceTab.parcelOutcome");
  const { data, derived, actions } = workspace;

  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [disposition, setDisposition] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The same gate the strength engine and the auto-submit guards read —
  // never a local re-derivation of "did a parcel come back".
  const returnedToSender = derived.caseStrength?.returnedToSender?.triggered === true;

  /* WHAT THE CARRIER SAID, IF ANYTHING — a hint, never a pre-selection.
   *
   * Pre-selecting would let a merchant click through and ship the
   * carrier's guess as their own sworn answer; only the merchant's answer
   * is citable to the bank, so the merchant has to make it. What this
   * does is spare them from guessing when the carrier already recorded
   * it. Usually null: measured on prod, carriers mostly emit a bare
   * "returned to sender" with no reason at all. */
  const deliveryPayload = (data?.pack?.evidenceItemsByField?.delivery_proof?.payload ??
    data?.pack?.evidenceItemsByField?.shipping_tracking?.payload ??
    null) as Record<string, unknown> | null;
  const returnHint = resolveDeliveryReceipt(deliveryPayload).returnHint;
  // Name the carrier in the hint so the merchant knows whose record it is
  // and can go check the tracking page themselves.
  const carrierName =
    buildDeliveryPresentation(deliveryPayload).trackingLinks[0]?.carrier ?? null;

  const offerable = canOfferParcelOutcome({
    returnedToSender,
    merchantAnsweredParcelOutcome: merchantAnsweredParcelOutcomeFromItems(
      data?.pack?.evidenceItems,
    ),
    submissionState: data?.dispute?.submissionState ?? null,
    finalOutcome: data?.dispute?.finalOutcome ?? null,
  });
  if (!offerable) return null;

  // Hide while a rebuild is in flight — the consolidated regenerating
  // banner upstream carries the status, and leaving the CTA up invites a
  // second submission that contradicts it.
  if (derived.isBuilding || derived.isRegenerating) return null;

  const canSubmit = !!reason && !!disposition && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await actions.submitParcelOutcome(
        reason,
        disposition,
        note.trim() || null,
      );
      if (!result.ok) {
        setErrorMessage(
          result.code === "WINDOW_CLOSED"
            ? t("errorWindowClosed")
            : t("errorGeneric", { code: result.code ?? "unknown" }),
        );
        return;
      }
      setReason("");
      setDisposition("");
      setNote("");
      setExpanded(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div
        role="region"
        aria-label={t("ctaEyebrow")}
        style={{
          background: "linear-gradient(180deg, #FFF7ED 0%, #FFFBF5 100%)",
          border: "1px solid #FED7AA",
          borderRadius: 12,
          padding: 20,
          display: "grid",
          gridTemplateColumns: "44px 1fr",
          gap: 16,
          boxShadow: "0 1px 0 rgba(154, 82, 15, 0.04)",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "#FFEDD5",
            color: "#C2410C",
            display: "grid",
            placeItems: "center",
          }}
        >
          {/* Parcel turning back — the fact this card is about. */}
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
            <path d="M21 8v13H3V8" />
            <path d="M1 3h22v5H1z" />
            <path d="M14 17l-3-3 3-3" />
            <path d="M11 14h5" />
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
              color: "#C2410C",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 4px",
            }}
          >
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: "50%", background: "#C2410C" }}
            />
            {t("ctaEyebrow")}
          </p>
          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#7C2D12",
              margin: "0 0 6px",
              lineHeight: 1.4,
            }}
          >
            {t("title")}
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "#9A3412",
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
                background: "#C2410C",
                color: "#fff",
                border: "1px solid transparent",
                boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.18)",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              {t("ctaButton")}
            </button>
            <span style={{ fontSize: 12, color: "#B45309" }}>{t("ctaMeta")}</span>
          </div>
        </div>
      </div>
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
          <Select
            label={t("reasonLabel")}
            helpText={
              returnHint && carrierName
                ? t("reasonHintFromCarrier", {
                    carrier: carrierName,
                    reason: t(`reason.${returnHint}`),
                  })
                : t("reasonHint")
            }
            options={[
              { label: t("choosePlaceholder"), value: "" },
              ...REASONS.map((r) => ({ label: t(`reason.${r}`), value: r })),
            ]}
            value={reason}
            onChange={setReason}
            disabled={submitting}
          />
          <Select
            label={t("dispositionLabel")}
            helpText={t("dispositionHint")}
            options={[
              { label: t("choosePlaceholder"), value: "" },
              ...DISPOSITIONS.map((d) => ({ label: t(`disposition.${d}`), value: d })),
            ]}
            value={disposition}
            onChange={setDisposition}
            disabled={submitting}
          />
          <TextField
            label={t("noteLabel")}
            value={note}
            onChange={setNote}
            multiline={3}
            maxLength={MAX_NOTE}
            autoComplete="off"
            placeholder={t("notePlaceholder")}
            helpText={t("noteHint")}
            disabled={submitting}
          />
          <InlineStack gap="200" align="end">
            <Button
              onClick={() => {
                setExpanded(false);
                setReason("");
                setDisposition("");
                setNote("");
                setErrorMessage(null);
              }}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

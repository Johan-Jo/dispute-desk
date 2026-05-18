/**
 * EvidenceTab — four-section IA composition.
 *
 * Replaces the legacy 1737-LOC tab with a thin orchestrator that
 * delegates to four labelled sections fed by `useEvidenceSections`.
 * The hook is the single source of truth for view-model shape;
 * no scoring, no classification, no payload mutation happens here.
 *
 * The four sections (in order):
 *   1. Case summary           — strength / status / automation / next step
 *   2. Evidence used in defense — all supporting signals (submitted or not)
 *   3. Missing or weak evidence — actionable gaps; collapses if empty
 *   4. Internal-only signals    — always rendered with empty-state copy
 *
 * Build/load/failed states and upload success are surfaced as Polaris
 * Banners ABOVE the sections. Forbidden in this tab: percentages, predictive copy,
 * "Likely outcome", "Prepared for you", "83% evidence collected".
 */

"use client";

import type { ReactElement } from "react";
import { useTranslations, useLocale } from "next-intl";
import { BlockStack, Banner, Spinner } from "@shopify/polaris";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { useEvidenceSections } from "./useEvidenceSections";
import { CaseSummaryCard } from "./sections/CaseSummaryCard";
import { EvidenceUsedSection } from "./sections/EvidenceUsedSection";
import { MissingOrWeakSection } from "./sections/MissingOrWeakSection";
import { InternalOnlySignalsSection } from "./sections/InternalOnlySignalsSection";
import { RegeneratePromptModal } from "./sections/RegeneratePromptModal";
import { CardholderAcknowledgementCard } from "./sections/CardholderAcknowledgementCard";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

interface Props {
  workspace: Workspace;
}

export default function EvidenceTab({ workspace }: Props) {
  const t = useTranslations("disputes.evidenceTab");
  const locale = useLocale();
  const { data, derived, clientState, actions } = workspace;
  const sections = useEvidenceSections(workspace);

  // ── Loading state ──
  // Initial load before workspace fetch completes. Keep this brief
  // and centred; once data lands the sections render immediately.
  if (clientState.loading && !data) {
    return (
      <BlockStack gap="400" align="center">
        <Spinner accessibilityLabel="Loading evidence" />
      </BlockStack>
    );
  }

  // ── Build-failed banner ──
  // Distinct from evidence gaps: the build itself errored. Short,
  // honest copy — never a stack trace, never the raw failureReason.
  const failedBanner = derived.isFailed ? (
    <Banner tone="critical" title="Evidence pack build failed">
      <p>
        We couldn&apos;t build this evidence pack. Try resyncing the dispute or
        regenerating the pack from the dispute header.
      </p>
    </Banner>
  ) : null;

  // ── Resubmission Window banners ──
  // Priority (top-down, mutually exclusive): closed > regenerating >
  // first-time-building > window-open. The closed state suppresses
  // the upload-success banner so we don't claim a file was added at
  // the same time we're telling the merchant uploads are disabled.
  const isWindowClosed =
    data?.dispute?.submissionState === "submitted_confirmed";
  const isWindowOpen =
    data?.dispute?.submissionState === "saved_to_shopify";

  const formattedSubmittedAt = data?.dispute?.submittedAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
      }).format(new Date(data.dispute.submittedAt))
    : null;

  const windowClosedBanner = isWindowClosed ? (
    <Banner tone="info" title={t("windowClosedBanner.title")}>
      <p>
        {formattedSubmittedAt
          ? t("windowClosedBanner.body", {
              submittedAt: formattedSubmittedAt,
            })
          : t("windowClosedBanner.bodyNoDate")}
      </p>
    </Banner>
  ) : null;

  const regeneratingBanner =
    !isWindowClosed && derived.isRegenerating ? (
      <Banner tone="info" title={t("regeneratingBanner.title")}>
        <p>{t("regeneratingBanner.body")}</p>
      </Banner>
    ) : null;

  // ── In-progress banner (first-time build only) ──
  // Suppressed when regeneratingBanner is active — the regenerate
  // variant tells the merchant the current saved package remains on
  // the Shopify dispute, which is the truth in that case.
  const buildingBanner =
    derived.isBuilding && !derived.isRegenerating && !isWindowClosed ? (
      <Banner tone="info" title="Building evidence pack">
        <p>The pack is being assembled. Refresh shortly to see updates.</p>
      </Banner>
    ) : null;

  // ── Rebuild-outcome banner ──
  // Surfaces the result of the most recent merchant-initiated regenerate
  // so the workspace can answer "what happened after I clicked
  // Regenerate?". Only renders when:
  //   - a rebuild outcome exists (`lastRebuildOutcome` non-null)
  //   - the regenerate isn't currently in flight (otherwise the
  //     regenerating banner is the correct signal)
  //   - the merchant hasn't dismissed this specific outcome timestamp
  //   - the resubmission window isn't closed (the closed banner takes
  //     precedence)
  // The banner is purely user-facing — `lastRebuildOutcome` is not an
  // authoritative submission state per `lib/automation/rebuildOutcome.ts`.
  const rebuildOutcome = data?.pack?.lastRebuildOutcome ?? null;
  const rebuildOutcomeAt = data?.pack?.lastRebuildAt ?? null;
  // Staleness gate: if the pack has been rebuilt since the outcome was
  // stamped, the outcome describes a previous save attempt against
  // out-of-date data — suppress the banner. buildPack also clears the
  // outcome columns on success, so this is belt-and-suspenders.
  const packUpdatedAt = data?.pack?.updatedAt ?? null;
  const rebuildOutcomeIsStale =
    !!rebuildOutcome &&
    !!rebuildOutcomeAt &&
    !!packUpdatedAt &&
    new Date(rebuildOutcomeAt).getTime() < new Date(packUpdatedAt).getTime();
  const showRebuildOutcomeBanner =
    !!rebuildOutcome &&
    !rebuildOutcomeIsStale &&
    !derived.isRegenerating &&
    !isWindowClosed &&
    clientState.dismissedRebuildOutcomeAt !== rebuildOutcomeAt;

  let rebuildOutcomeBanner: ReactElement | null = null;
  if (showRebuildOutcomeBanner && rebuildOutcome) {
    const key = `disputes.evidenceTab.rebuildOutcomeBanner.${rebuildOutcome}`;
    const tone =
      rebuildOutcome === "saved"
        ? "success"
        : rebuildOutcome === "failed"
          ? "critical"
          : "warning";
    rebuildOutcomeBanner = (
      <Banner
        tone={tone}
        title={t(`rebuildOutcomeBanner.${rebuildOutcome}.title`)}
        onDismiss={() => actions.dismissRebuildOutcome(rebuildOutcomeAt)}
      >
        <p>{t(`rebuildOutcomeBanner.${rebuildOutcome}.body`)}</p>
      </Banner>
    );
    // Silence the unused-key lint warning — the actual translation key
    // is built dynamically above; keeping `key` referenced for grep.
    void key;
  }

  const windowOpenBanner =
    isWindowOpen && !derived.isRegenerating && !isWindowClosed ? (
      <Banner tone="success" title={t("windowOpenBanner.title")}>
        <p>{t("windowOpenBanner.body")}</p>
      </Banner>
    ) : null;

  // ── No-pack state ──
  // Pack was never generated. The sections will render in their
  // empty-state forms; this banner is the merchant-facing prompt.
  const noPackBanner =
    !data?.pack && !derived.isBuilding && !derived.isFailed ? (
      <Banner tone="warning" title="No evidence pack yet">
        <p>Generate an evidence pack from the dispute header to see your defense.</p>
      </Banner>
    ) : null;

  const uploadSuccessBanner =
    clientState.uploadSuccessNotice && !isWindowClosed ? (
      <Banner
        tone="success"
        title={t("uploadSuccessTitle")}
        onDismiss={() => actions.dismissUploadSuccessNotice()}
      >
        <p>
          {t("uploadSuccessBody", {
            fileName: clientState.uploadSuccessNotice.fileName,
            evidenceTitle: clientState.uploadSuccessNotice.evidenceTitle,
          })}
        </p>
      </Banner>
    ) : null;

  return (
    <BlockStack gap="500">
      {failedBanner}
      {windowClosedBanner}
      {regeneratingBanner}
      {rebuildOutcomeBanner}
      {buildingBanner}
      {windowOpenBanner}
      {noPackBanner}
      {uploadSuccessBanner}

      {/* §1 — Case summary */}
      <CaseSummaryCard {...sections.caseSummary} />

      {/* §2 — Evidence in your defence package.
              Three buckets driven by EvidenceLineItem booleans:
                - Used as positive bank argument
                - Context only (in PDF but not relied on as proof)
                - On file — not included
              The explainer text is conditional on whether any row is
              actually `usedAsPositiveBankEvidence`. */}
      <EvidenceUsedSection
        items={sections.usedInDefense}
        lineItems={data?.evidenceLineItems ?? []}
      />

      {/* Cardholder acknowledgement — merchant pastes a confirming
              message from the cardholder + ticks the attestation
              checkbox. Server records the confirmation, patches
              checklist_v2, enqueues a build_pack rebuild, and (for
              window-open disputes) opens RegeneratePromptModal so the
              new PDF reaches Shopify. Hides itself when the dispute is
              closed, already submitted to bank, or when
              customer_communication is already a positive bank
              argument. */}
      <CardholderAcknowledgementCard workspace={workspace} />

      {/* §3 — Missing or weak evidence (collapses when empty)
              Inline actions: Upload evidence + Mark as not applicable.
              Both delegate to existing workspace actions; no new
              backend calls. `focusField` + `onFocusCleared` drive the
              yellow-pulse highlight when the merchant arrives via the
              Overview tab's "Add this evidence" CTA. */}
      <MissingOrWeakSection
        items={sections.missingOrWeak}
        uploadingField={clientState.uploadingField}
        focusField={clientState.focusField}
        onFocusCleared={actions.clearFocus}
        uploadsDisabled={isWindowClosed}
        onUpload={(field, files) => {
          void actions.uploadEvidence(field, files);
        }}
        onWaive={(field, reason) => {
          void actions.waiveItem(field, reason);
        }}
      />

      {/* §4 — Internal-only signals (ALWAYS rendered; empty-state copy
              when no signals — gives the merchant a definitive answer
              to "is anything being held back?") */}
      <InternalOnlySignalsSection items={sections.internalOnly} />

      {/* Resubmission Window — confirmation modal opens after an
          upload succeeds with promptRebuild=true. Confirm calls
          POST /api/packs/:packId/regenerate which re-enqueues the
          full pipeline (build_pack → defence_package → save_to_shopify
          → overwrites the prior PDF on the Shopify dispute). */}
      <RegeneratePromptModal
        open={clientState.pendingRegeneratePrompt !== null}
        mode={data?.appliedRule?.mode ?? null}
        submitting={clientState.regenerateSubmitting}
        error={clientState.regenerateError}
        onConfirm={() => {
          void actions.regeneratePack();
        }}
        onCancel={() => actions.dismissRegeneratePrompt()}
      />
    </BlockStack>
  );
}

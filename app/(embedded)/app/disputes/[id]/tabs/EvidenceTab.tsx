/**
 * EvidenceTab — Evidence Tab redesign composition.
 *
 * Thin orchestrator delegating to view-model sections fed by
 * `useEvidenceSections`. The hook is the single source of truth for
 * shape; no scoring, no classification, no payload mutation here.
 *
 * Section order (matches `Dispute Page Evidence Tab.html`):
 *   1. Case summary
 *   2. Cardholder acknowledgement CTA — promoted blue card placed
 *      immediately under the summary so a high-impact action sits in
 *      eye-line. Self-hides for closed / window-closed disputes and
 *      when customer_communication is already a positive bank argument.
 *   3. Evidence in your defence package — unified card with up to four
 *      disposition sections (positive / context / internal / excluded).
 *      The previous "Internal-only signals" card is folded in as the
 *      third disposition bucket so internal signals appear exactly
 *      once across the tab.
 *   4. Missing or weak evidence — actionable gaps; collapses if empty.
 *
 * Build/load/failed/upload-success states are surfaced as Polaris
 * Banners ABOVE the sections. Forbidden in this tab: percentages,
 * predictive copy, "Likely outcome", "Prepared for you", "83% evidence
 * collected".
 */

"use client";

import type { ReactElement } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toBcp47Loose } from "@/lib/i18n/bcp47";
import { BlockStack, Banner, Spinner } from "@shopify/polaris";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { useEvidenceSections } from "./useEvidenceSections";
import { CaseSummaryCard } from "./sections/CaseSummaryCard";
import { EvidenceUsedSection } from "./sections/EvidenceUsedSection";
import { MissingOrWeakSection } from "./sections/MissingOrWeakSection";
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
    ? new Intl.DateTimeFormat(toBcp47Loose(locale), {
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

  // When the rebuild outcome is "saved" AND the Shopify window is still
  // open, the two banners say overlapping things (both green, both
  // confirming the package is on the Shopify dispute). Merge them into
  // one block so the merchant doesn't read two stacked green banners as
  // two separate events. The merged banner keeps the outcome's title +
  // dismissible chrome and adds the window-state body underneath.
  const showWindowOpen =
    isWindowOpen && !derived.isRegenerating && !isWindowClosed;
  const shouldMergeSavedWithWindow =
    showRebuildOutcomeBanner &&
    rebuildOutcome === "saved" &&
    showWindowOpen;

  let rebuildOutcomeBanner: ReactElement | null = null;
  if (showRebuildOutcomeBanner && rebuildOutcome) {
    const key = `disputes.evidenceTab.rebuildOutcomeBanner.${rebuildOutcome}`;
    // "Saved to Shopify" outcome gets the design's custom banner-stack
    // chrome (dark-green header strip + light-green tinted body). The
    // other outcomes (`failed`, `blocked_*`) still ride Polaris Banner
    // — they're rare, and the design doesn't specify their treatment.
    if (rebuildOutcome === "saved") {
      rebuildOutcomeBanner = (
        <SavedToShopifyBanner
          title={t(`rebuildOutcomeBanner.${rebuildOutcome}.title`)}
          primaryBody={t(`rebuildOutcomeBanner.${rebuildOutcome}.body`)}
          secondaryBody={
            shouldMergeSavedWithWindow ? t("windowOpenBanner.body") : null
          }
          onDismiss={() => actions.dismissRebuildOutcome(rebuildOutcomeAt)}
        />
      );
    } else {
      const tone =
        rebuildOutcome === "failed" ? ("critical" as const) : ("warning" as const);
      rebuildOutcomeBanner = (
        <Banner
          tone={tone}
          title={t(`rebuildOutcomeBanner.${rebuildOutcome}.title`)}
          onDismiss={() => actions.dismissRebuildOutcome(rebuildOutcomeAt)}
        >
          <p>{t(`rebuildOutcomeBanner.${rebuildOutcome}.body`)}</p>
        </Banner>
      );
    }
    // Silence the unused-key lint warning — the actual translation key
    // is built dynamically above; keeping `key` referenced for grep.
    void key;
  }

  const windowOpenBanner =
    showWindowOpen && !shouldMergeSavedWithWindow ? (
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

      {/* §2 — Cardholder acknowledgement CTA — promoted above the
              evidence card so the high-impact "decisive evidence for
              fraud disputes" action sits at the top of the work area.
              The card self-hides when the dispute is closed, when
              Shopify has already forwarded to the bank, or when
              customer_communication is already a positive bank
              argument — so its prominence never contradicts the
              actual case state. */}
      <CardholderAcknowledgementCard workspace={workspace} />

      {/* §3 — Evidence in your defence package.
              Unified card with up to four disposition sections, each
              flagged by a coloured chip header:
                - Used as positive bank argument
                - Context only (in PDF but not relied on as proof)
                - Kept internal (assessment-only; not submitted)
                - On file — not included
              Internal signals (previously surfaced as a separate
              "Internal-only signals" card below) are passed through as
              the third disposition bucket so the merchant sees one
              source of truth. */}
      <EvidenceUsedSection
        items={sections.usedInDefense}
        lineItems={data?.evidenceLineItems ?? []}
        internalSignals={sections.internalOnly}
      />

      {/* §4 — Missing or weak evidence (collapses when empty)
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

/**
 * SavedToShopifyBanner — custom banner-stack chrome for the "saved"
 * rebuild outcome. Matches the Dispute Page Evidence Tab design's
 * `.BannerStack`: a dark-green header strip carrying the title +
 * circular check icon + dismiss button, sharing rounded corners with
 * a light-green tinted body block underneath. Polaris `Banner` was
 * close but couldn't reproduce the two-tone stack — the header strip
 * needs `#008060` background with white text, the body needs the
 * lighter `#F0FDF4` fill with `#86EFAC` border, and the corners only
 * round at the outer four (top-left/right on the strip,
 * bottom-left/right on the body) so the two pieces visually stitch.
 *
 * Both body paragraphs are rendered when `secondaryBody` is non-null;
 * the design lays them out as two paragraphs with a small gap (not as
 * a single flowing paragraph) so each sentence reads cleanly.
 */
function SavedToShopifyBanner({
  title,
  primaryBody,
  secondaryBody,
  onDismiss,
}: {
  title: string;
  primaryBody: string;
  secondaryBody: string | null;
  onDismiss: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        role="status"
        style={{
          background: "#008060",
          color: "#fff",
          borderRadius: "8px 8px 0 0",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
            style={{ width: 18, height: 18 }}
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L9 10.94 7.28 9.22a.75.75 0 1 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25Z"
            />
          </svg>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>
          {title}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            appearance: "none",
            background: "transparent",
            border: 0,
            color: "inherit",
            cursor: "pointer",
            padding: 4,
            borderRadius: 6,
            lineHeight: 0,
            marginLeft: "auto",
          }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
            style={{ width: 16, height: 16 }}
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>
      <div
        style={{
          background: "#F0FDF4",
          border: "1px solid #86EFAC",
          borderTop: 0,
          borderRadius: "0 0 8px 8px",
          padding: "12px 16px",
          fontSize: 13,
          color: "#14532D",
          lineHeight: 1.5,
        }}
      >
        <p style={{ margin: 0 }}>{primaryBody}</p>
        {secondaryBody ? (
          <p style={{ margin: "6px 0 0" }}>{secondaryBody}</p>
        ) : null}
      </div>
    </div>
  );
}

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

import { useTranslations } from "next-intl";
import { BlockStack, Banner, Spinner } from "@shopify/polaris";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { useEvidenceSections } from "./useEvidenceSections";
import { CaseSummaryCard } from "./sections/CaseSummaryCard";
import { EvidenceUsedSection } from "./sections/EvidenceUsedSection";
import { MissingOrWeakSection } from "./sections/MissingOrWeakSection";
import { InternalOnlySignalsSection } from "./sections/InternalOnlySignalsSection";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

interface Props {
  workspace: Workspace;
}

export default function EvidenceTab({ workspace }: Props) {
  const t = useTranslations("disputes.evidenceTab");
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

  // ── In-progress banner ──
  // The build is queued or running. The four sections still render
  // (with whatever data is available); this banner just makes the
  // in-flight state visible.
  const buildingBanner = derived.isBuilding ? (
    <Banner tone="info" title="Building evidence pack">
      <p>The pack is being assembled. Refresh shortly to see updates.</p>
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

  const uploadSuccessBanner = clientState.uploadSuccessNotice ? (
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
      {buildingBanner}
      {noPackBanner}
      {uploadSuccessBanner}

      {/* §1 — Case summary */}
      <CaseSummaryCard {...sections.caseSummary} />

      {/* §2 — Evidence used in defense (Strong → Moderate → Supporting) */}
      <EvidenceUsedSection items={sections.usedInDefense} />

      {/* §3 — Missing or weak evidence (collapses when empty)
              Inline actions: Upload evidence + Mark as not applicable.
              Both delegate to existing workspace actions; no new
              backend calls. */}
      <MissingOrWeakSection
        items={sections.missingOrWeak}
        uploadingField={clientState.uploadingField}
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
    </BlockStack>
  );
}

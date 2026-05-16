/**
 * ReviewSubmitTab — four-section IA composition.
 *
 * Replaces the legacy 1354-LOC tab with a thin orchestrator that
 * delegates to four labelled sections fed by `useReviewView`.
 *
 * The four sections (in order):
 *   1. Submission status         — submitted vs ready-to-submit (CTA)
 *   2. Exact data sent to Shopify — five readable groups, byte-for-byte
 *   3. Not submitted (transparency)
 *   4. Final defense statement   — the bank-rebuttal text + Regenerate
 *
 * Override-submit modal lives at this level. When the view-model
 * marks `cta.requiresOverride === true` (readiness blocked or weak),
 * the click opens a Modal that captures a reason + optional note
 * and routes through the existing `actions.submitToShopify(reason,
 * note)` path. The merchant is never blocked outright.
 */

"use client";

import { useState } from "react";
import {
  BlockStack,
  Banner,
  Spinner,
  Modal,
  Select,
  TextField,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { useReviewView } from "./useReviewView";
import { useSubmissionPreview } from "./useSubmissionPreview";
import { SubmissionStatusCard } from "./sections/SubmissionStatusCard";
import { ExactDataSentCard } from "./sections/ExactDataSentCard";
import { NotSubmittedCard } from "./sections/NotSubmittedCard";
import { FinalDefenseStatementCard } from "./sections/FinalDefenseStatementCard";
import { CompleteDefencePackageCard } from "./sections/CompleteDefencePackageCard";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

const OVERRIDE_REASONS = [
  "will_provide_separately",
  "merchant_accepts_risk",
  "classifier_uncertain",
  "other",
] as const;
type OverrideReason = (typeof OVERRIDE_REASONS)[number];

interface Props {
  workspace: Workspace;
}

export default function ReviewSubmitTab({ workspace }: Props) {
  const { data, derived, clientState, actions } = workspace;
  const submissionPreview = useSubmissionPreview(data?.pack?.id ?? null);
  const view = useReviewView(workspace, submissionPreview);
  const tOverride = useTranslations("disputes.reviewTab.sections.override");

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] =
    useState<OverrideReason>("merchant_accepts_risk");
  const [overrideNote, setOverrideNote] = useState("");

  // ── Loading state ──
  if (clientState.loading && !data) {
    return (
      <BlockStack gap="400" align="center">
        <Spinner accessibilityLabel="Loading review" />
      </BlockStack>
    );
  }

  // ── Failed / building / no-pack banners ──
  const failedBanner = derived.isFailed ? (
    <Banner tone="critical" title="Evidence pack build failed">
      <p>
        We couldn&apos;t build this evidence pack. Try resyncing the dispute or
        regenerating the pack from the dispute header.
      </p>
    </Banner>
  ) : null;

  const buildingBanner = derived.isBuilding ? (
    <Banner tone="info" title="Building evidence pack">
      <p>The pack is being assembled. Refresh shortly to see updates.</p>
    </Banner>
  ) : null;

  const noPackBanner =
    !data?.pack && !derived.isBuilding && !derived.isFailed ? (
      <Banner tone="warning" title="No evidence pack yet">
        <p>Generate an evidence pack from the dispute header before you can review and submit.</p>
      </Banner>
    ) : null;

  // ── File evidence reinstall consent banner (Phase 7b) ──
  // Only shown when the file evidence layer is enabled but the
  // merchant's offline session was issued before the new dispute
  // file upload scopes shipped (commit f61176c). Reinstalling the
  // app from the Shopify Admin app listing will refresh the scopes.
  const reinstallBanner =
    data?.fileEvidence?.flagEnabled && data.fileEvidence.scopesGranted === false ? (
      <Banner tone="warning" title="Reinstall DisputeDesk to enable native file evidence">
        <p>
          DisputeDesk now uploads evidence files directly into Shopify&rsquo;s
          chargeback response file rows (Shipping documentation, Customer
          communication, etc.) — but your store&rsquo;s permissions don&rsquo;t
          include the new <code>{data.fileEvidence.missingScopes.join(", ")}</code>{" "}
          {data.fileEvidence.missingScopes.length === 1 ? "scope" : "scopes"} yet.
          Reinstall the app from the Shopify Admin app listing to refresh
          permissions. Until then, evidence continues to ship as labelled
          links in the dispute text.
        </p>
      </Banner>
    ) : null;

  // ── Submit handler ──
  // Routes through the override modal when the view-model says the
  // current readiness requires explicit intent. Otherwise submits
  // directly. Either path lands on the same workspace action — the
  // override args travel into the audit log via the existing API.
  const handleSubmit = () => {
    if (view.cta?.requiresOverride) {
      setOverrideOpen(true);
      return;
    }
    void actions.submitToShopify();
  };

  const handleOverrideConfirm = () => {
    void actions.submitToShopify(
      overrideReason,
      overrideNote.trim() || undefined,
    );
    setOverrideOpen(false);
    setOverrideNote("");
  };

  const handleOverrideCancel = () => {
    setOverrideOpen(false);
    setOverrideNote("");
  };

  // ── Regenerate handler ──
  const handleRegenerate = () => {
    void actions.regenerateArgument();
  };

  return (
    <BlockStack gap="500">
      {failedBanner}
      {buildingBanner}
      {noPackBanner}
      {reinstallBanner}

      {/* §1 — Submission status (submitted vs ready-to-submit + CTA) */}
      <SubmissionStatusCard
        state={view.state}
        submittedAt={view.submittedAt}
        shopifyAdminUrl={view.shopifyAdminUrl}
        cta={view.cta}
        onSubmit={handleSubmit}
      />

      {/* §2 — Final defense statement. The rebuttal letter is the
          merchant's primary "did we say the right thing?" surface, so
          it sits above the structured-field detail. Collapses when no
          rebuttal text exists. */}
      <FinalDefenseStatementCard
        text={view.bankRebuttalText}
        derivedFrom={view.derivedFrom}
        outdated={view.rebuttalOutdated}
        regenerating={clientState.regeneratingArgument}
        onRegenerate={handleRegenerate}
      />

      {/* §2.5 — Complete Defence Package (Grounded Defence Package PDF
          Builder). Hidden when ENABLE_DEFENCE_PACKAGE_BUILDER is off or
          no defence_packages row exists for the pack yet. */}
      <CompleteDefencePackageCard packId={data?.pack?.id ?? null} />

      {/* §3 — Exact data sent to Shopify (six readable groups, including
          customer details, native file slot routing, merchant uploads,
          and the auto-generated pack PDF). The uncategorizedText field
          is intentionally suppressed in this section because its body
          IS the rebuttal text rendered above. */}
      <ExactDataSentCard
        state={view.state}
        payload={view.payload}
        loading={view.payloadLoading}
      />

      {/* §4 — Not submitted (transparency, collapses when empty) */}
      <NotSubmittedCard items={view.notSubmitted} />

      {/* Override-submit modal — only mounted when the merchant clicks
          submit on a blocked / ready_with_warnings case. Reason +
          optional note flow into the audit log via the existing
          submitToShopify action. */}
      <Modal
        open={overrideOpen}
        onClose={handleOverrideCancel}
        title={tOverride("title")}
        primaryAction={{
          content: tOverride("confirm"),
          onAction: handleOverrideConfirm,
          loading: clientState.saving,
          destructive: true,
        }}
        secondaryActions={[
          { content: tOverride("cancel"), onAction: handleOverrideCancel },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <p>{tOverride("body")}</p>
            <Select
              label={tOverride("reasonLabel")}
              options={OVERRIDE_REASONS.map((r) => ({
                label: tOverride(`reason.${r}`),
                value: r,
              }))}
              value={overrideReason}
              onChange={(v) => setOverrideReason(v as OverrideReason)}
            />
            <TextField
              label={tOverride("noteLabel")}
              placeholder={tOverride("notePlaceholder")}
              value={overrideNote}
              onChange={(v) => setOverrideNote(v)}
              autoComplete="off"
              multiline={3}
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}

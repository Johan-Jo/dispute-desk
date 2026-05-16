/**
 * ReviewSubmitTab — post-retirement composition.
 *
 * The bank-facing artifact is the defence-package PDF.
 * `CompleteDefencePackageCard` is the only rebuttal surface; the
 * legacy `FinalDefenseStatementCard` and `NotSubmittedCard` were
 * deleted along with the text-rebuttal engine on 2026-05-16.
 *
 * Section order:
 *   1. Submission status         — submitted vs ready-to-submit (CTA)
 *   2. Complete Defence Package  — narrative + PDF + Preview/Finalize/Submit
 *   3. Exact data sent           — customer info + PDF attachment row only
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

  // ── Submit handler ──
  // Routes through the override modal when the view-model says the
  // current readiness requires explicit intent.
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

  return (
    <BlockStack gap="500">
      {failedBanner}
      {buildingBanner}
      {noPackBanner}

      {/* §1 — Submission status (submitted vs ready-to-submit + CTA) */}
      <SubmissionStatusCard
        state={view.state}
        submittedAt={view.submittedAt}
        shopifyAdminUrl={view.shopifyAdminUrl}
        cta={view.cta}
        onSubmit={handleSubmit}
      />

      {/* §2 — Complete Defence Package (status + actions + inline HTML
          mirror of the PDF). Always rendered; the card itself surfaces
          the appropriate state banner (Draft / Stale / Final / Failed /
          Skipped) when no narrative-bearing row exists. */}
      <CompleteDefencePackageCard
        packId={data?.pack?.id ?? null}
        dispute={
          data?.dispute
            ? {
                disputeGid: data.dispute.disputeGid ?? null,
                orderName: data.dispute.orderName ?? null,
                reason: data.dispute.reason ?? null,
                amount: data.dispute.amount ?? null,
                currencyCode: data.dispute.currency ?? null,
                cardholderName: data.dispute.customerName ?? null,
                shopName: data.dispute.shopDomain ?? null,
                merchantName: data.dispute.shopDomain ?? null,
                dueAt: data.dispute.dueAt ?? null,
              }
            : undefined
        }
      />

      {/* §3 — Exact data sent to Shopify. Post-retirement: customer
          info + the defence-package PDF attachment row. Nothing else. */}
      <ExactDataSentCard
        state={view.state}
        payload={view.payload}
        loading={view.payloadLoading}
      />

      {/* Override-submit modal — only mounted when the merchant clicks
          submit on a blocked / ready_with_warnings case. */}
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

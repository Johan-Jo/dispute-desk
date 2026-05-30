/**
 * ReviewSubmitTab — post-retirement composition.
 *
 * Single card: `CompleteDefencePackageCard`. Submission state
 * (submitted to Shopify vs ready-to-submit) is rendered inside the
 * card's header. The standalone `SubmissionStatusCard` was merged in
 * 2026-05-16 — two stacked cards saying overlapping things felt
 * redundant on a tab dedicated to one artifact.
 */

"use client";

import { BlockStack, Banner, Spinner } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { useReviewView } from "./useReviewView";
import {
  CompleteDefencePackageCard,
  type DefencePackageRow,
} from "./sections/CompleteDefencePackageCard";
import { InclusionReviewSection } from "./sections/InclusionReviewSection";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

interface Props {
  workspace: Workspace;
}

export default function ReviewSubmitTab({ workspace }: Props) {
  const { data, derived, clientState, actions } = workspace;
  const view = useReviewView(workspace);
  const tExtra = useTranslations("disputes.evidenceTabExtra");
  const tChrome = useTranslations("disputes.reviewTab.chrome");

  // ── Loading state ──
  if (clientState.loading && !data) {
    return (
      <BlockStack gap="400" align="center">
        <Spinner accessibilityLabel={tChrome("loadingReview")} />
      </BlockStack>
    );
  }

  // ── Failed / building / no-pack banners ──
  const failedBanner = derived.isFailed ? (
    <Banner tone="critical" title={tExtra("buildFailedTitle")}>
      <p>{tChrome("buildFailedBody")}</p>
    </Banner>
  ) : null;

  const buildingBanner = derived.isBuilding ? (
    <Banner tone="info" title={tExtra("buildingTitle")}>
      <p>{tExtra("buildingBody")}</p>
    </Banner>
  ) : null;

  const noPackBanner =
    !data?.pack && !derived.isBuilding && !derived.isFailed ? (
      <Banner tone="warning" title={tExtra("noPackTitle")}>
        <p>{tExtra("noPackBodyReview")}</p>
      </Banner>
    ) : null;

  return (
    <BlockStack gap="500">
      {failedBanner}
      {buildingBanner}
      {noPackBanner}

      {/* Complete Defence Package — the primary card on this tab.
          Mounted first so the merchant sees the submission state,
          the "ready to resubmit" banner, and Finalize/Submit actions
          before the supporting inclusion-review detail below. */}
      <div data-tour="review-defence-package">
      <CompleteDefencePackageCard
        packId={data?.pack?.id ?? null}
        submittedToShopifyAt={view.submittedAt}
        shopifyAdminUrl={view.shopifyAdminUrl}
        presentationStatus={data?.presentationStatus}
        evidenceSentOn={data?.dispute?.submittedAt ?? null}
        // Defence package rows lifted from the workspace endpoint
        // (2026-05-25). Pre-lift the card owned its own fetch and
        // re-paid a round-trip every time the merchant switched to
        // this tab. Now switching tabs is instant — the rows are
        // already in memory and the workspace's 4s poll keeps them
        // fresh. The workspace endpoint types these as `unknown` so
        // the shared module doesn't depend on defence-narrative
        // types; the card owns the row shape and we narrow here.
        defencePackage={
          data?.defencePackage
            ? {
                latest: (data.defencePackage.latest as DefencePackageRow | null) ?? null,
                bankFacing: (data.defencePackage.bankFacing as DefencePackageRow | null) ?? null,
                currentPromptVersion: data.defencePackage.currentPromptVersion,
              }
            : undefined
        }
        onRefresh={() => actions.fetchAll()}
        onSubmitted={() => {
          // Flip derived.isReadOnly immediately so the card re-renders
          // into the "Saved to Shopify" layout without waiting for the
          // 4s workspace poll. Kick a fetch in parallel so the real
          // `saved_to_shopify_at` arrives as soon as the job persists.
          actions.markJustSubmitted();
          void actions.fetchAll();
        }}
        dispute={
          data?.dispute
            ? {
                shopId: data.dispute.shopId ?? null,
                disputeGid: data.dispute.disputeGid ?? null,
                orderName: data.dispute.orderName ?? null,
                reason: data.dispute.reason ?? null,
                amount: data.dispute.amount ?? null,
                currencyCode: data.dispute.currency ?? null,
                cardNetwork: data.dispute.cardNetwork ?? null,
                cardLast4: data.dispute.cardLast4 ?? null,
                transactionDate: data.dispute.transactionDate ?? null,
                paymentGateway: data.dispute.paymentGateway ?? null,
                financialStatus: data.dispute.financialStatus ?? null,
                fulfillmentStatus: data.dispute.fulfillmentStatus ?? null,
                cardholderName:
                  data.dispute.cardholderName ?? data.dispute.customerName ?? null,
                shopName: data.dispute.shopDomain ?? null,
                merchantName: data.dispute.shopDomain ?? null,
                dueAt: data.dispute.dueAt ?? null,
                // Rich Shopify Order.events timeline — the SAME array
                // the PDF builder threads through meta.timelineEvents.
                // Surfaces in the HTML view's Chronology of Events
                // bullets so the merchant's web view matches the
                // bank-facing PDF byte-for-byte.
                timelineEvents: data.dispute.timelineEvents ?? undefined,
              }
            : undefined
        }
      />
      </div>

      {/* Inclusion review — Phase 1 read-only inspection of every
          evidence row with an audit-logged toggle for the safe set.
          Mounted below the package card as a supporting detail; the
          merchant's primary actions live on the card above. */}
      <div data-tour="review-inclusion">
        <InclusionReviewSection
          packId={data?.pack?.id ?? null}
          lineItems={data?.evidenceLineItems ?? []}
          onToggleInclusionOverride={actions.toggleInclusionOverride}
        />
      </div>
    </BlockStack>
  );
}

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
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { useReviewView } from "./useReviewView";
import { CompleteDefencePackageCard } from "./sections/CompleteDefencePackageCard";
import { InclusionReviewSection } from "./sections/InclusionReviewSection";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

interface Props {
  workspace: Workspace;
}

export default function ReviewSubmitTab({ workspace }: Props) {
  const { data, derived, clientState, actions } = workspace;
  const view = useReviewView(workspace);

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

  return (
    <BlockStack gap="500">
      {failedBanner}
      {buildingBanner}
      {noPackBanner}

      {/* Complete Defence Package — the primary card on this tab.
          Mounted first so the merchant sees the submission state,
          the "ready to resubmit" banner, and Finalize/Submit actions
          before the supporting inclusion-review detail below. */}
      <CompleteDefencePackageCard
        packId={data?.pack?.id ?? null}
        submittedToShopifyAt={view.submittedAt}
        shopifyAdminUrl={view.shopifyAdminUrl}
        presentationStatus={data?.presentationStatus}
        evidenceSentOn={data?.dispute?.submittedAt ?? null}
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

      {/* Inclusion review — Phase 1 read-only inspection of every
          evidence row with an audit-logged toggle for the safe set.
          Mounted below the package card as a supporting detail; the
          merchant's primary actions live on the card above. */}
      <InclusionReviewSection
        packId={data?.pack?.id ?? null}
        lineItems={data?.evidenceLineItems ?? []}
        onToggleInclusionOverride={actions.toggleInclusionOverride}
      />
    </BlockStack>
  );
}

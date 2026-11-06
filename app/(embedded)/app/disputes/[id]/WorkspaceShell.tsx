"use client";

import { Page, Spinner } from "@shopify/polaris";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { getShopifyDisputeUrl, getShopifyOrderUrl } from "@/lib/shopify/shopifyAdminUrl";
import { buildDisputeRecord } from "@/lib/disputes/disputeRecord";
import { createRecordFormat } from "@/lib/disputes/recordFormat";
import { useDisputeWorkspace } from "./hooks/useDisputeWorkspace";
import RecordWorkspace from "./record/RecordWorkspace";
import { recordInputsFromWorkspace, type WorkspaceWithPatterns } from "./record/recordInputs";
import { TAB_INDEX } from "./workspace-components/types";

export default function WorkspaceShell({ disputeId }: { disputeId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const workspace = useDisputeWorkspace(disputeId);
  const { data, clientState, actions } = workspace;

  /** Resolve a Shopify dispute reason code to its merchant-facing
   *  translated label. Replaces the lib-side `merchantDisputeReasonLabel`
   *  for UI use — the lib still owns the bank-rebuttal English path. */
  const reasonLabelFor = (reason: string | null | undefined): string => {
    if (!reason) return t("disputes.workspaceShell.merchantReasonLabel.fallback");
    const key = reason.toUpperCase().replace(/\s+/g, "_");
    try {
      const resolved = t(`disputes.workspaceShell.merchantReasonLabel.${key}`);
      const fallbackPath = "disputes.workspaceShell.merchantReasonLabel.fallback";
      if (resolved === `disputes.workspaceShell.merchantReasonLabel.${key}`) {
        return t(fallbackPath);
      }
      return resolved;
    } catch {
      return t("disputes.workspaceShell.merchantReasonLabel.fallback");
    }
  };

  // Deep link support: `?section=…` opens the Evidence tab so the merchant
  // lands ON the card instead of the top of the Overview tab. Each card
  // handles its own scroll-into-view (and expand, or transient highlight)
  // off the same param. Run once, only after data has loaded so the tab
  // panel is mounted.
  //
  //   gorgias-comms   — evidence-ready email → matched-conversation review
  //   cardholder-ack  — held new-dispute email → the one contribution a
  //                     held case can take (lib/disputes/heldState)
  const deepLinkApplied = useRef(false);
  const targetSection = searchParams.get("section");
  useEffect(() => {
    if (deepLinkApplied.current || !data) return;
    if (targetSection === "gorgias-comms" || targetSection === "cardholder-ack") {
      deepLinkApplied.current = true;
      actions.setActiveTab(TAB_INDEX.evidence);
    }
  }, [data, targetSection, actions]);

  const backUrl = withShopParams("/app/disputes", searchParams);

  if (clientState.loading || !data) {
    return (
      <Page
        title={t("disputes.disputeTitle", { id: disputeId.slice(0, 8) })}
        backAction={{ content: t("disputes.backToDisputes"), url: backUrl }}
      >
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  const dispute = data.dispute;
  const reasonLabel = reasonLabelFor(dispute.reason);
  /* THE ORDER NUMBER, NOT A UUID FRAGMENT. The title shows the order name when
   * there is one; the UUID fragment is only a fallback for a dispute synced
   * before its order resolved. The title links to the ORDER (Shopify addresses
   * orders by internal id, so the link and the label legitimately differ). */
  const orderName = dispute.orderName?.trim() || null;
  const headerTitle = orderName
    ? t("disputes.workspaceShell.headerTitleOrder", { order: orderName, reason: reasonLabel })
    : t("disputes.workspaceShell.headerTitle", { id: dispute.id.slice(0, 8).toUpperCase(), reason: reasonLabel });
  const orderUrl = getShopifyOrderUrl(dispute.shopDomain, dispute.orderGid);
  // "View in Shopify Admin" — navigational only; null hides the link (never a guessed URL).
  const shopifyAdminUrl = getShopifyDisputeUrl(dispute.shopDomain, dispute.disputeEvidenceGid);

  /* The dispute page (Claude Design `NewDispute`) for every state: ONE record of
   * facts feeds the header and all three tabs (lib/disputes/disputeRecord.ts). */
  const fmt = createRecordFormat(locale);
  // An unassessed or stale assessment renders no verdict (lib/disputes/assessmentPresence).
  const inputs = recordInputsFromWorkspace(data as WorkspaceWithPatterns, new Date().toISOString());
  const record = buildDisputeRecord(
    workspace.derived.assessment.mayRenderVerdict ? inputs : { ...inputs, strength: null },
    fmt,
  );
  return (
    <RecordWorkspace
      workspace={workspace}
      record={record}
      fmt={fmt}
      backUrl={backUrl}
      headerTitle={headerTitle}
      reasonLabel={reasonLabel}
      orderUrl={orderName ? orderUrl : null}
      shopifyAdminUrl={shopifyAdminUrl}
    />
  );
}

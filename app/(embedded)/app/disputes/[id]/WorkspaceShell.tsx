"use client";

import { Page, Tabs, Spinner, Banner, BlockStack } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { useDisputeWorkspace } from "./hooks/useDisputeWorkspace";
import OverviewTab from "./tabs/OverviewTab";
import EvidenceTab from "./tabs/EvidenceTab";
import ReviewSubmitTab from "./tabs/ReviewSubmitTab";

/** Merchant-facing labels for Shopify dispute reason codes. */
const MERCHANT_REASON_LABEL: Record<string, string> = {
  FRAUDULENT: "Unauthorized transaction",
  UNRECOGNIZED: "Unrecognized charge",
  PRODUCT_NOT_RECEIVED: "Item not received",
  PRODUCT_UNACCEPTABLE: "Item not as described",
  SUBSCRIPTION_CANCELED: "Subscription canceled",
  DUPLICATE: "Duplicate charge",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  GENERAL: "General dispute",
  BANK_CANNOT_PROCESS: "Bank could not process",
  CUSTOMER_INITIATED: "Customer-initiated dispute",
  DEBIT_NOT_AUTHORIZED: "Debit not authorized",
  INCORRECT_ACCOUNT_DETAILS: "Incorrect account details",
  INSUFFICIENT_FUNDS: "Insufficient funds",
  NONCOMPLIANT: "Noncompliant transaction",
};

function merchantReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Dispute";
  const key = reason.toUpperCase().replace(/\s+/g, "_");
  return MERCHANT_REASON_LABEL[key] ?? "Dispute";
}

export default function WorkspaceShell({ disputeId }: { disputeId: string }) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const workspace = useDisputeWorkspace(disputeId);
  const { data, clientState, derived, actions } = workspace;

  const tabs = [
    { id: "overview", content: "Overview", panelID: "overview-panel" },
    { id: "evidence", content: "Evidence", panelID: "evidence-panel" },
    { id: "submit", content: "Review & Submit", panelID: "submit-panel" },
  ];

  if (clientState.loading || !data) {
    return (
      <Page
        title={t("disputes.disputeTitle", { id: disputeId.slice(0, 8) })}
        backAction={{
          content: t("disputes.backToDisputes"),
          url: withShopParams("/app/disputes", searchParams),
        }}
      >
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  const dispute = data.dispute;
  const submitted = derived.isReadOnly;
  const deadlineDays = dispute.dueAt
    ? Math.ceil(
        (new Date(dispute.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;

  const orderRef = dispute.orderName || `#${disputeId.slice(0, 8)}`;
  const pageTitle = `Dispute ${orderRef} \u2014 ${merchantReasonLabel(dispute.reason)}`;

  const amountLabel = `${dispute.currency} ${dispute.amount}`;
  let statusLabel: string;
  if (submitted) {
    statusLabel = "Submitted";
  } else if (deadlineDays !== null && deadlineDays > 0) {
    statusLabel = `Respond within ${deadlineDays} day${deadlineDays === 1 ? "" : "s"}`;
  } else if (deadlineDays !== null && deadlineDays <= 0) {
    statusLabel = "Overdue";
  } else {
    statusLabel = dispute.phase === "chargeback" ? "Chargeback" : "Inquiry";
  }
  const subtitle = `${statusLabel} \u2022 ${amountLabel}`;

  return (
    <Page
      title={pageTitle}
      subtitle={subtitle}
      backAction={{
        content: t("disputes.backToDisputes"),
        url: withShopParams("/app/disputes", searchParams),
      }}
    >
      <BlockStack gap="400">
        <Tabs
          tabs={tabs}
          selected={clientState.activeTab}
          onSelect={(index) => actions.setActiveTab(index as 0 | 1 | 2)}
        >
          {clientState.activeTab === 0 && (
            <OverviewTab workspace={workspace} />
          )}
          {clientState.activeTab === 1 && (
            <EvidenceTab workspace={workspace} />
          )}
          {clientState.activeTab === 2 && (
            <ReviewSubmitTab workspace={workspace} />
          )}
        </Tabs>
      </BlockStack>
    </Page>
  );
}

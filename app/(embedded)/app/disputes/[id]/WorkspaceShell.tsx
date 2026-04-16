"use client";

import { Page, Tabs, Spinner, Banner, BlockStack } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { useDisputeWorkspace } from "./hooks/useDisputeWorkspace";
import OverviewTab from "./tabs/OverviewTab";
import EvidenceTab from "./tabs/EvidenceTab";
import ReviewSubmitTab from "./tabs/ReviewSubmitTab";

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
  const deadlineDays = dispute.dueAt
    ? Math.ceil(
        (new Date(dispute.dueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;
  const deadlineLabel =
    deadlineDays !== null && deadlineDays > 0
      ? ` \u2022 ${deadlineDays}d left`
      : deadlineDays !== null && deadlineDays <= 0
        ? " \u2022 Overdue"
        : "";

  const pageTitle = `${dispute.orderName || `#${disputeId.slice(0, 8)}`} \u2014 ${dispute.reason ?? "Dispute"}${deadlineLabel}`;

  return (
    <Page
      title={pageTitle}
      subtitle={`${dispute.phase === "chargeback" ? "Chargeback" : "Inquiry"} \u2022 ${dispute.currency} ${dispute.amount}`}
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

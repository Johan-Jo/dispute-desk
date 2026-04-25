"use client";

import { Page, Tabs, Spinner, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { merchantDisputeReasonLabel } from "@/lib/rules/disputeReasons";
import { useDisputeWorkspace } from "./hooks/useDisputeWorkspace";
import OverviewTab from "./tabs/OverviewTab";
import EvidenceTab from "./tabs/EvidenceTab";
import ReviewSubmitTab from "./tabs/ReviewSubmitTab";

const STRENGTH_LABEL: Record<string, string> = {
  strong: "Strong case",
  moderate: "Moderate case",
  weak: "Weak case",
  insufficient: "Weak case",
};

function strengthTone(level: string): "success" | "warning" | "critical" | undefined {
  if (level === "strong") return "success";
  if (level === "moderate") return "warning";
  return "critical";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export default function WorkspaceShell({ disputeId }: { disputeId: string }) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const workspace = useDisputeWorkspace(disputeId);
  const { data, derived, clientState, actions } = workspace;

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
  const reasonLabel = merchantDisputeReasonLabel(dispute.reason);
  const headerTitle = `Dispute #${dispute.id.slice(0, 8).toUpperCase()} — ${reasonLabel}`;

  const strengthKey = derived.caseStrength.overall;
  const strengthText = STRENGTH_LABEL[strengthKey] ?? "Weak case";

  const facts: Array<{ label: string; value: string }> = [
    { label: "Amount", value: `${dispute.currency} ${dispute.amount}` },
    { label: "Customer", value: dispute.customerName || "—" },
    { label: "Date filed", value: formatDate(dispute.openedAt) },
    { label: "Dispute reason", value: reasonLabel },
  ];

  return (
    <Page
      backAction={{
        content: t("disputes.backToDisputes"),
        url: withShopParams("/app/disputes", searchParams),
      }}
    >
      <BlockStack gap="400">
        {/* Clean white header card — shared across all 3 tabs (Figma design 2026-04-25) */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #E1E3E5",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 1px 0 rgba(22, 29, 37, 0.05)",
          }}
        >
          <BlockStack gap="300">
            <BlockStack gap="200">
              <Text as="h1" variant="headingLg">{headerTitle}</Text>
              <InlineStack gap="200" wrap>
                <Badge tone={submitted ? "success" : "attention"}>
                  {submitted ? "Submitted" : "Needs review"}
                </Badge>
                <Badge tone={strengthTone(strengthKey)}>{strengthText}</Badge>
              </InlineStack>
            </BlockStack>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "16px 24px",
                marginTop: 4,
              }}
            >
              {facts.map((f) => (
                <BlockStack key={f.label} gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">{f.label}</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{f.value}</Text>
                </BlockStack>
              ))}
            </div>
          </BlockStack>
        </div>

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

"use client";

import { Page, Spinner, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
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

  const tabs: Array<{ id: string; label: string; panelId: string }> = [
    { id: "overview", label: "Overview", panelId: "overview-panel" },
    { id: "evidence", label: "Evidence", panelId: "evidence-panel" },
    { id: "submit", label: "Review & Submit", panelId: "submit-panel" },
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

        {/* Figma-style tab strip: connected white card, blue underline on
            active tab. Replaces Polaris <Tabs> so the tab bar visually
            joins the panel below into a single rounded card. */}
        <div>
          <div
            role="tablist"
            aria-label="Dispute sections"
            style={{
              background: "#ffffff",
              border: "1px solid #E1E3E5",
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              borderBottom: 0,
              display: "flex",
            }}
          >
            {tabs.map((tab, index) => {
              const isActive = clientState.activeTab === index;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={tab.panelId}
                  id={`${tab.id}-tab`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => actions.setActiveTab(index as 0 | 1 | 2)}
                  style={{
                    appearance: "none",
                    background: "transparent",
                    border: 0,
                    borderBottom: `2px solid ${isActive ? "#005BD3" : "transparent"}`,
                    padding: "12px 24px",
                    fontSize: 14,
                    fontWeight: 500,
                    color: isActive ? "#005BD3" : "#6D7175",
                    cursor: "pointer",
                    lineHeight: 1.4,
                    fontFamily: "inherit",
                    marginBottom: -1,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={tabs[clientState.activeTab]?.panelId}
            aria-labelledby={`${tabs[clientState.activeTab]?.id}-tab`}
            style={{
              background: "#ffffff",
              border: "1px solid #E1E3E5",
              borderTop: "1px solid #E1E3E5",
              borderBottomLeftRadius: 12,
              borderBottomRightRadius: 12,
              padding: 20,
            }}
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
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}

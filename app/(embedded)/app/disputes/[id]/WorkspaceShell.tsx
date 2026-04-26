"use client";

import { Page, Spinner, BlockStack } from "@shopify/polaris";
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

/** Figma-style flat pill — `px-2 py-0.5 rounded-md text-xs font-semibold`
 *  with the matching strength palette. Matches `shopify-dispute-detail`
 *  Make source (lines 47-55). */
function strengthPillColors(level: string): { bg: string; color: string } {
  if (level === "strong") return { bg: "#D1FAE5", color: "#065F46" };
  if (level === "moderate") return { bg: "#FEF3C7", color: "#92400E" };
  return { bg: "#FEE2E2", color: "#991B1B" };
}

const PILL_STYLE = {
  padding: "2px 8px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap" as const,
  display: "inline-flex",
  alignItems: "center",
};

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
        {/* Persistent header card — shared across all 3 tabs.
            Matches the Figma `shopify-dispute-detail` design (lines
            68-103): rounded-lg (8px) card with shadow-sm, 20px padding,
            flat rectangular status pills, and a top-border divider
            between the title row and the metadata grid. */}
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            padding: 20,
            boxShadow: "0 1px 2px 0 rgba(22, 29, 37, 0.05)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: "#202223",
                  margin: 0,
                  marginBottom: 12,
                  lineHeight: 1.4,
                }}
              >
                {headerTitle}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    ...PILL_STYLE,
                    background: submitted ? "#D1FAE5" : "#FEE2E2",
                    color: submitted ? "#065F46" : "#991B1B",
                  }}
                >
                  {submitted ? "Submitted" : "Needs action"}
                </span>
                {(() => {
                  const c = strengthPillColors(strengthKey);
                  return (
                    <span style={{ ...PILL_STYLE, background: c.bg, color: c.color }}>
                      {strengthText}
                    </span>
                  );
                })()}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 16,
                paddingTop: 16,
                borderTop: "1px solid #E1E3E5",
              }}
            >
              {facts.map((f) => (
                <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "#6D7175", lineHeight: 1.4 }}>{f.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#202223", lineHeight: 1.4 }}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
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

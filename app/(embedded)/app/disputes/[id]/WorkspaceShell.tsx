"use client";

import { Page, Spinner, BlockStack } from "@shopify/polaris";
import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import { useDisputeWorkspace } from "./hooks/useDisputeWorkspace";
import OverviewTab from "./tabs/OverviewTab";
import EvidenceTab from "./tabs/EvidenceTab";
import ReviewSubmitTab from "./tabs/ReviewSubmitTab";
import { TAB_INDEX } from "./workspace-components/types";
import {
  ATTENTION_CHIP,
  LIFECYCLE_CHIP,
  STRENGTH_CHIP,
  type ChipTokens,
} from "@/lib/disputes/presentation/uiTokens";
import { resolveStrength } from "@/lib/disputes/presentation/resolveStrength";
import { attentionLabelKey } from "@/lib/disputes/presentation/labels";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";

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

/** BCP-47 mapping for `toLocaleDateString`. Short-code locales like
 *  `sv` work for date formatting; passing the active locale keeps month
 *  names in the merchant's language. Falls back to `undefined` (host)
 *  on unrecognized inputs. */
function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export default function WorkspaceShell({ disputeId }: { disputeId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const workspace = useDisputeWorkspace(disputeId);
  const { data, derived, clientState, actions } = workspace;

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

  // Tab order per reviewer direction 2026-07-24: Overview → Evidence →
  // Review and Forward (rightmost — the last step of the flow). Array
  // order MUST match TAB_INDEX in workspace-components/types.ts.
  const tabs: Array<{ id: string; label: string; panelId: string }> = [
    { id: "overview", label: t("disputes.workspaceShell.tabs.overview"), panelId: "overview-panel" },
    { id: "evidence", label: t("disputes.workspaceShell.tabs.evidence"), panelId: "evidence-panel" },
    { id: "submit", label: t("disputes.workspaceShell.tabs.reviewSubmit"), panelId: "submit-panel" },
  ];

  // Deep link support: `?section=gorgias-comms` (from the evidence-ready
  // email) opens the Evidence tab so the merchant lands ON the review card
  // instead of the top of the Overview tab. The card itself handles the
  // scroll-into-view + transient highlight off the same param. Run once,
  // only after data has loaded so the tab panel is mounted.
  const deepLinkApplied = useRef(false);
  const targetSection = searchParams.get("section");
  useEffect(() => {
    if (deepLinkApplied.current || !data) return;
    if (targetSection === "gorgias-comms") {
      deepLinkApplied.current = true;
      actions.setActiveTab(TAB_INDEX.evidence);
    }
  }, [data, targetSection, actions]);

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
  const reasonLabel = reasonLabelFor(dispute.reason);
  const headerTitle = t("disputes.workspaceShell.headerTitle", {
    id: dispute.id.slice(0, 8).toUpperCase(),
    reason: reasonLabel,
  });

  // Shared presentation model — the API-resolved interpretation (never
  // re-derived here). Strength falls back to the workspace engine
  // result through the same pass-through resolver.
  const presentation = data.presentation ?? null;
  const strength =
    presentation?.strength ?? resolveStrength(derived.caseStrength.overall);
  const headerChips: Array<{ key: string; label: string; tokens: ChipTokens }> = [];
  if (presentation) {
    headerChips.push({
      key: "lifecycle",
      label: t(`presentation.lifecycle.${presentation.lifecycle}`),
      tokens: LIFECYCLE_CHIP[presentation.lifecycle],
    });
  }
  headerChips.push({
    key: "strength",
    label: t(`presentation.strength.detail.${strength}`),
    tokens: STRENGTH_CHIP[strength],
  });
  // Attention pill ONLY when attention ≠ none — never rendered merely
  // because of an involvement preference (plan §6.1).
  if (presentation && presentation.attention !== "none") {
    headerChips.push({
      key: "attention",
      label: t(attentionLabelKey(presentation)),
      tokens: ATTENTION_CHIP[presentation.attention],
    });
  }

  // Deadline line — only while the response can still change (the
  // mockup hides it once transmission is confirmed or the dispute is
  // terminal).
  const showDeadline = Boolean(
    dispute.dueAt && presentation && presentation.editable,
  );

  // "View in Shopify Admin" — navigational only. Reuses the reliable
  // URL builder; when it returns null the action is HIDDEN (never a
  // guessed fallback URL — plan §6.1).
  const shopifyAdminUrl = getShopifyDisputeUrl(
    dispute.shopDomain,
    dispute.disputeEvidenceGid,
  );

  const facts: Array<{ label: string; value: string }> = [
    { label: t("disputes.workspaceShell.facts.amount"), value: `${dispute.currency} ${dispute.amount}` },
    { label: t("disputes.workspaceShell.facts.customer"), value: dispute.customerName || "—" },
    { label: t("disputes.workspaceShell.facts.dateFiled"), value: formatDate(dispute.openedAt, locale) },
    { label: t("disputes.workspaceShell.facts.disputeReason"), value: reasonLabel },
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
          data-help-guide="detail-header"
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {headerChips.map((chip) => (
                  <span
                    key={chip.key}
                    style={{
                      ...PILL_STYLE,
                      gap: 5,
                      background: chip.tokens.bg,
                      color: chip.tokens.fg,
                    }}
                  >
                    {chip.tokens.dot ? (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: chip.tokens.dot,
                          flex: "none",
                        }}
                      />
                    ) : null}
                    {chip.label}
                  </span>
                ))}
                {showDeadline ? (
                  <span style={{ fontSize: 12.5, color: "#6D7175", lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 600, color: "#4B5563" }}>
                      {t("presentation.deadlineLabel")}
                    </span>
                    {": "}
                    {formatDate(dispute.dueAt, locale)}
                  </span>
                ) : null}
                {shopifyAdminUrl ? (
                  <a
                    href={shopifyAdminUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      marginLeft: "auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      borderRadius: 8,
                      padding: "8px 13px",
                      lineHeight: 1.2,
                      whiteSpace: "nowrap",
                      border: "1px solid #C9CCCF",
                      background: "#ffffff",
                      color: "#202223",
                      boxShadow: "0 1px 0 rgba(0,0,0,.04)",
                      textDecoration: "none",
                    }}
                  >
                    {t("disputes.overviewExtra.viewInShopify")}
                  </a>
                ) : null}
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
            aria-label={t("disputes.workspaceShell.disputeSectionsAria")}
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
                  data-help-guide={`detail-tab-${tab.id}`}
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
            {clientState.activeTab === TAB_INDEX.overview && (
              <OverviewTab workspace={workspace} />
            )}
            {clientState.activeTab === TAB_INDEX.reviewForward && (
              <ReviewSubmitTab workspace={workspace} />
            )}
            {clientState.activeTab === TAB_INDEX.evidence && (
              <EvidenceTab workspace={workspace} />
            )}
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}

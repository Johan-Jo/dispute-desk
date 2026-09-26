"use client";

/**
 * Decided (won/lost) dispute workspace — transcribed from Claude Design
 * `Decided Dispute View.dc.html` / `DecidedView.dc.html` (project 39b1425e…),
 * plan `docs/plans/decided-dispute-view.plan.md` PR 2. The design is the spec
 * (CLAUDE.md rule 8): values below are the design's, element by element.
 *
 * Content comes from `buildDecidedView` (lib/disputes/decidedView) — every
 * string is a token resolved here. No actions on this page: the Evidence and
 * Review tabs remain reachable but the tab row is labelled read-only.
 */

import { Page, BlockStack } from "@shopify/polaris";
import type { CSSProperties, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { buildDecidedView, type ChecklistState, type TimelineTone } from "@/lib/disputes/decidedView";
import type { DecidedViewInputs } from "@/lib/disputes/decidedView";
import type { WorkspaceDispute } from "./workspace-components/types";

/* Design-system tokens (_ds_bundle.css :root). */
const DD = {
  bg: "#F6F8FB",
  surface: "#FFFFFF",
  text: "#0B1220",
  subtle: "#667085",
  border: "#E5E7EB",
  primary: "#1D4ED8",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
} as const;

/* DisputeDeskUI.Badge variants (components/ui/badge.tsx). */
const BADGE = {
  danger: { background: "#FEE2E2", color: "#991B1B", border: "1px solid #FECACA" },
  success: { background: "#DCFCE7", color: "#166534", border: "1px solid #BBF7D0" },
  default: { background: "#F1F5F9", color: "#64748B", border: "1px solid #E5E7EB" },
} as const;

const TONE: Record<TimelineTone, string> = {
  muted: DD.subtle,
  neutral: DD.border,
  warning: DD.warning,
  primary: DD.primary,
  danger: DD.danger,
  success: DD.success,
};

const CHECK: Record<ChecklistState, { mark: string; color: string }> = {
  had: { mark: "✓", color: DD.success },
  missing: { mark: "✕", color: DD.danger },
  none: { mark: "–", color: DD.subtle },
};

const card = {
  background: DD.surface,
  border: `1px solid ${DD.border}`,
  borderRadius: 12,
} as const;

function Badge({ variant, children }: { variant: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span
      style={{
        ...BADGE[variant],
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: "16px",
      }}
    >
      {children}
    </span>
  );
}

export interface DecidedWorkspaceProps {
  dispute: WorkspaceDispute;
  inputs: DecidedViewInputs;
  backUrl: string;
  orderUrl: string | null;
  shopifyAdminUrl: string | null;
  tabs: Array<{ id: string; label: string; panelId: string }>;
  activeTab: number;
  onTabChange: (index: 0 | 1 | 2) => void;
  /** Evidence / Review tab bodies, rendered unchanged. */
  renderTab: (index: number) => ReactNode;
}

export default function DecidedWorkspace(props: DecidedWorkspaceProps) {
  const { dispute, inputs } = props;
  const t = useTranslations();
  const locale = useLocale();

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale || undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso.slice(0, 10);
    }
  };
  const fmtShort = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale || undefined, { month: "short", day: "numeric" });
    } catch {
      return iso.slice(5, 10);
    }
  };
  const fmtMoney = (amount: number, currency: string) =>
    `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : amount}`;

  const view = buildDecidedView(inputs, { date: fmtDate, money: fmtMoney });
  const r = (token: Parameters<typeof resolveToken>[1]) => resolveToken(t, token);
  const lost = inputs.outcome === "lost";
  const money = fmtMoney(inputs.amount, inputs.currency);
  const orderLabel = dispute.orderName?.trim() || dispute.id.slice(0, 8).toUpperCase();

  const headerFacts: Array<{ label: string; value: string }> = [
    { label: t("disputes.workspaceShell.facts.amount"), value: `${dispute.currency} ${dispute.amount}` },
    { label: t("disputes.workspaceShell.facts.customer"), value: dispute.customerName || "—" },
    { label: t("disputes.decidedView.header.opened"), value: dispute.openedAt ? fmtDate(dispute.openedAt) : "—" },
    { label: t("disputes.decidedView.header.due"), value: dispute.dueAt ? fmtDate(dispute.dueAt) : "—" },
    { label: t("disputes.decidedView.header.decided"), value: inputs.closedAt ? fmtDate(inputs.closedAt) : "—" },
  ];

  const onOverview = props.activeTab === 0;

  return (
    <Page backAction={{ content: t("disputes.backToDisputes"), url: props.backUrl }}>
      <BlockStack gap="400">
        <div
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            color: DD.text,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Header card */}
          <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
                  {/* The design shows plain text; the order link is kept
                      (merchants trace a dispute back to its order) and styled
                      to read exactly as the design's plain title. */}
                  {props.orderUrl ? (
                    <a
                      href={props.orderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      {t("disputes.decidedView.header.title", { order: orderLabel })}
                    </a>
                  ) : (
                    t("disputes.decidedView.header.title", { order: orderLabel })
                  )}
                </h1>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {lost ? (
                    <Badge variant="danger">{t("disputes.outcomeLost")}</Badge>
                  ) : (
                    <Badge variant="success">{t("disputes.outcomeWon")}</Badge>
                  )}
                  <Badge variant="default">
                    {dispute.phase === "inquiry" ? t("disputes.inquiryBadge") : t("disputes.chargebackBadge")}
                  </Badge>
                </div>
              </div>
              {props.shopifyAdminUrl ? (
                <a
                  href={props.shopifyAdminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 32,
                    padding: "0 12px",
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 8,
                    background: "#F1F5F9",
                    color: DD.text,
                    border: `1px solid ${DD.border}`,
                    whiteSpace: "nowrap",
                    flex: "none",
                    textDecoration: "none",
                  }}
                >
                  {t("disputes.overviewExtra.viewInShopify")}
                </a>
              ) : null}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "12px 20px",
                fontSize: 13,
              }}
            >
              {headerFacts.map((f) => (
                <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: DD.subtle }}>{f.label}</span>
                  <span style={{ fontWeight: 500 }}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tab row */}
          <div
            role="tablist"
            aria-label={t("disputes.workspaceShell.disputeSectionsAria")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              borderBottom: `1px solid ${DD.border}`,
              fontSize: 14,
              flexWrap: "wrap",
            }}
          >
            {props.tabs.map((tab, index) => {
              const active = props.activeTab === index;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={tab.panelId}
                  id={`${tab.id}-tab`}
                  onClick={() => props.onTabChange(index as 0 | 1 | 2)}
                  style={{
                    appearance: "none",
                    background: "transparent",
                    border: 0,
                    borderBottom: `2px solid ${active ? DD.primary : "transparent"}`,
                    padding: "8px 0",
                    marginBottom: -1,
                    fontSize: 14,
                    fontFamily: "inherit",
                    fontWeight: active ? 600 : 400,
                    color: active ? DD.text : DD.subtle,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
            <span style={{ marginLeft: "auto", fontSize: 12, color: DD.subtle, padding: "8px 0" }}>
              {t("disputes.decidedView.readOnly")}
            </span>
          </div>

          {!onOverview ? (
            <div
              role="tabpanel"
              id={props.tabs[props.activeTab]?.panelId}
              aria-labelledby={`${props.tabs[props.activeTab]?.id}-tab`}
              style={{ ...card, padding: 20 }}
            >
              {props.renderTab(props.activeTab)}
            </div>
          ) : (
            <div
              role="tabpanel"
              id={props.tabs[0]?.panelId}
              aria-labelledby={`${props.tabs[0]?.id}-tab`}
              style={{ display: "flex", flexDirection: "column", gap: 16 }}
            >
              {/* Outcome card */}
              <div style={{ ...card, overflow: "hidden" }}>
                <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                      gap: "8px 24px",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: lost ? DD.danger : DD.success,
                            flex: "none",
                          }}
                        />
                        <span style={{ fontSize: 18, fontWeight: 600 }}>{r(view.outcome.title)}</span>
                        {view.outcome.decidedAt ? (
                          <span style={{ fontSize: 14, color: DD.subtle }}>
                            {t("disputes.decidedView.outcome.decided", { date: fmtDate(view.outcome.decidedAt) })}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 14, color: DD.subtle, textWrap: "pretty" } as CSSProperties}>
                        {view.outcome.product
                          ? `${r(view.outcome.product)} · ${r(view.outcome.claim)}`
                          : r(view.outcome.claim)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                      <span style={{ fontSize: 12, color: DD.subtle }}>{r(view.outcome.amountLabel)}</span>
                      <span
                        style={{
                          fontSize: 24,
                          fontWeight: 600,
                          letterSpacing: "-0.02em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {money}
                      </span>
                    </div>
                  </div>
                  {view.who ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr)",
                        gap: 4,
                        padding: "12px 14px",
                        background: DD.bg,
                        borderRadius: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: DD.subtle,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {t("disputes.decidedView.who.title")}
                      </span>
                      <span style={{ fontSize: 14, lineHeight: 1.55, textWrap: "pretty" } as CSSProperties}>
                        {r(view.who.first)}
                      </span>
                      {view.who.second ? (
                        <span
                          style={{ fontSize: 14, lineHeight: 1.55, color: DD.subtle, textWrap: "pretty" } as CSSProperties}
                        >
                          {r(view.who.second)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    borderTop: `1px solid ${DD.border}`,
                    padding: "12px 20px",
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    gap: "6px 16px",
                    fontSize: 13,
                    color: DD.subtle,
                  }}
                >
                  <span>{t("disputes.decidedView.outcome.final")}</span>
                  {props.shopifyAdminUrl ? (
                    <span>
                      {t.rich("disputes.decidedView.outcome.bankReasoning", {
                        link: (chunks) => (
                          <a
                            href={props.shopifyAdminUrl ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: DD.primary, textDecoration: "none" }}
                          >
                            {chunks}
                          </a>
                        ),
                      })}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Facts + checklist */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                {view.facts.items.length > 0 ? (
                  <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{r(view.facts.title)}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {view.facts.items.map((f, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.5 }}>
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              background: DD.subtle,
                              flex: "none",
                              marginTop: 8,
                            }}
                          />
                          <span style={{ textWrap: "pretty" } as CSSProperties}>{r(f)}</span>
                        </div>
                      ))}
                    </div>
                    {view.facts.note ? (
                      <div
                        style={{
                          fontSize: 13,
                          lineHeight: 1.55,
                          color: DD.subtle,
                          borderTop: `1px solid ${DD.border}`,
                          paddingTop: 12,
                          textWrap: "pretty",
                        } as CSSProperties}
                      >
                        {r(view.facts.note)}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {view.checklist.length > 0 ? (
                  <div style={{ ...card, padding: "20px 20px 8px", display: "flex", flexDirection: "column" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: 12,
                        paddingBottom: 10,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{t("disputes.decidedView.checklist.title")}</span>
                      <span style={{ fontSize: 12, color: DD.subtle, flex: "none" }}>
                        {t("disputes.decidedView.checklist.thisCase")}
                      </span>
                    </div>
                    {view.checklist.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "10px 0",
                          borderTop: `1px solid ${DD.border}`,
                          fontSize: 14,
                          lineHeight: 1.45,
                        }}
                      >
                        <span style={{ textWrap: "pretty" } as CSSProperties}>{r(c.item)}</span>
                        <span
                          style={{
                            flex: "none",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 13,
                            fontWeight: 500,
                            color: CHECK[c.state].color,
                          }}
                        >
                          <span style={{ fontSize: 12 }} aria-hidden="true">
                            {CHECK[c.state].mark}
                          </span>
                          {r(c.label)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Next time — lost only */}
              {view.nextTime.length > 0 ? (
                <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{t("disputes.decidedView.next.title")}</div>
                  {view.nextTime.map((n, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span
                        style={{
                          flex: "none",
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          border: `1px solid ${DD.border}`,
                          fontSize: 12,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: DD.subtle,
                        }}
                      >
                        {i + 1}
                      </span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 14, lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 500, textWrap: "pretty" } as CSSProperties}>{r(n.title)}</span>
                        {n.detail ? (
                          <span style={{ color: DD.subtle, textWrap: "pretty" } as CSSProperties}>{r(n.detail)}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* What happened */}
              {view.timeline.length > 0 ? (
                <div style={{ ...card, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{t("disputes.decidedView.timeline.title")}</div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {view.timeline.map((s, i) => {
                      const last = i === view.timeline.length - 1;
                      return (
                        <div
                          key={i}
                          style={{ display: "grid", gridTemplateColumns: "52px 14px minmax(0, 1fr)", gap: "0 10px" }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: DD.subtle,
                              paddingTop: 1,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {fmtShort(s.at)}
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <span
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: "50%",
                                background: TONE[s.tone],
                                marginTop: 4,
                                flex: "none",
                              }}
                            />
                            <span
                              style={{
                                width: 1,
                                flex: 1,
                                background: DD.border,
                                minHeight: 12,
                                opacity: last ? 0 : 1,
                              }}
                            />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 14 }}>
                            <span style={{ fontSize: 14, fontWeight: 500 }}>{r(s.title)}</span>
                            {s.detail ? (
                              <span
                                style={{ fontSize: 13, color: DD.subtle, lineHeight: 1.5, textWrap: "pretty" } as CSSProperties}
                              >
                                {r(s.detail)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </BlockStack>
    </Page>
  );
}

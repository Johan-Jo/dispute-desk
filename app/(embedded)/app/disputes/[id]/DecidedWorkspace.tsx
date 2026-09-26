"use client";

/**
 * Decided (won/lost) dispute workspace — transcribed from Claude Design
 * `Decided Dispute View.dc.html` → `DecidedView3.dc.html` (project 39b1425e…),
 * plan `docs/plans/decided-dispute-view.plan.md`. The design is the spec
 * (CLAUDE.md rule 8): the values below are the design's, element by element.
 *
 * Content comes from `buildDecidedView` (lib/disputes/decidedView); the
 * executive summary paragraph is assembled by `decidedSummaryParagraph`, the
 * same function the outcome email uses.
 */

import { Page } from "@shopify/polaris";
import type { CSSProperties, ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import {
  buildDecidedView,
  type ChecklistState,
  type DecidedViewInputs,
  type TimelineTone,
} from "@/lib/disputes/decidedView";
import { decidedSummaryParagraph } from "@/lib/disputes/decidedViewText";
import type { WorkspaceDispute } from "./workspace-components/types";

/* Design-system tokens (_ds_bundle.css :root) and the design's literals. */
const DD = {
  surface: "#FFFFFF",
  text: "#0B1220",
  subtle: "#667085",
  border: "#E5E7EB",
  primary: "#1D4ED8",
  success: "#22C55E",
  danger: "#EF4444",
} as const;

/* DisputeDeskUI.Badge variants (components/ui/badge.tsx). */
const BADGE = {
  danger: { background: "#FEE2E2", color: "#991B1B", border: "1px solid #FECACA" },
  success: { background: "#DCFCE7", color: "#166534", border: "1px solid #BBF7D0" },
} as const;

const STATE: Record<ChecklistState, { dot: string; bar: string; pillBg: string; pillFg: string }> = {
  had: { dot: DD.success, bar: DD.success, pillBg: "#ECFDF3", pillFg: "#067647" },
  missing: { dot: DD.danger, bar: "#F59E9E", pillBg: "#FEF3F2", pillFg: "#B42318" },
  none: { dot: "#98A2B3", bar: "#D0D5DD", pillBg: "#EEF0F3", pillFg: "#475467" },
};

const STEP: Record<TimelineTone, { ring: string; dot: string; title: string }> = {
  muted: { ring: "#F2F4F7", dot: "#98A2B3", title: DD.text },
  neutral: { ring: "#F2F4F7", dot: "#98A2B3", title: DD.text },
  warning: { ring: "#FFFAEB", dot: "#F59E0B", title: DD.text },
  primary: { ring: "#EFF4FF", dot: "#1D4ED8", title: DD.text },
  danger: { ring: "#FEF3F2", dot: "#EF4444", title: "#B42318" },
  success: { ring: "#ECFDF3", dot: "#22C55E", title: "#067647" },
};

const HERO = {
  lost: {
    bg: "#F9FAFB",
    border: DD.border,
    divider: DD.border,
    tileBg: "#E4E7EC",
    tileFg: "#475467",
    chipBg: "#EEF0F3",
    chipFg: "#344054",
    chipDot: "#98A2B3",
    amount: DD.text,
  },
  won: {
    bg: "#F0FDF4",
    border: "#BBF7D0",
    divider: "#D1FADF",
    tileBg: "#D1FADF",
    tileFg: "#067647",
    chipBg: "#DCFCE7",
    chipFg: "#067647",
    chipDot: "#22C55E",
    amount: "#067647",
  },
} as const;

/** Indent that lines body text up under the title once the hero is wide
 *  enough (design: `clamp(0px, calc((100% - 420px) * 999), 56px)`). */
const HERO_INDENT = "clamp(0px, calc((100% - 420px) * 999), 56px)";

const panel: CSSProperties = { border: `1px solid ${DD.border}`, borderRadius: 8 };
const softBox: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "12px 14px",
  background: "#F6F8FB",
  border: "1px solid #E8ECF2",
  borderRadius: 8,
};
const pretty = { textWrap: "pretty" } as CSSProperties;

export interface DecidedWorkspaceProps {
  dispute: WorkspaceDispute;
  inputs: DecidedViewInputs;
  reasonLabel: string;
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

  const view = buildDecidedView(inputs, { date: fmtDate, short: fmtShort, money: fmtMoney });
  const r = (token: I18nToken) => resolveToken(t, token);
  const lost = inputs.outcome === "lost";
  const hero = lost ? HERO.lost : HERO.won;
  const summary = decidedSummaryParagraph(view, (tok) => r(tok), locale);
  const orderLabel = dispute.orderName?.trim() || dispute.id.slice(0, 8).toUpperCase();
  const headerTitle = t("disputes.workspaceShell.headerTitleOrder", {
    order: orderLabel,
    reason: props.reasonLabel,
  });
  const had = view.checklist.filter((c) => c.state === "had").length;

  const headerFacts: Array<{ label: string; value: string }> = [
    { label: t("disputes.workspaceShell.facts.amount"), value: `${dispute.currency} ${dispute.amount}` },
    { label: t("disputes.workspaceShell.facts.customer"), value: dispute.customerName || "—" },
    { label: t("disputes.workspaceShell.facts.dateFiled"), value: dispute.openedAt ? fmtDate(dispute.openedAt) : "—" },
    { label: t("disputes.workspaceShell.facts.disputeReason"), value: props.reasonLabel },
  ];

  const onOverview = props.activeTab === 0;

  return (
    <Page backAction={{ content: t("disputes.backToDisputes"), url: props.backUrl }}>
      <div
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          color: DD.text,
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header card */}
        <div
          style={{
            background: DD.surface,
            ...panel,
            padding: "20px 18px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", margin: 0, ...pretty }}>
                {/* Plain title in the design; the order link is kept (merchants
                    trace a dispute back to its order) and styled to read the
                    same. */}
                {props.orderUrl ? (
                  <a
                    href={props.orderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {headerTitle}
                  </a>
                ) : (
                  headerTitle
                )}
              </h1>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    ...(lost ? BADGE.danger : BADGE.success),
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 6,
                    padding: "4px 8px",
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: "16px",
                  }}
                >
                  {lost ? t("disputes.outcomeLost") : t("disputes.outcomeWon")}
                </span>
                {inputs.closedAt ? (
                  <span style={{ fontSize: 12, color: DD.subtle }}>
                    <strong style={{ color: DD.text, fontWeight: 600 }}>
                      {t("disputes.decidedView.header.decided")}
                    </strong>{" "}
                    {fmtDate(inputs.closedAt)}
                  </span>
                ) : null}
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
              borderTop: `1px solid ${DD.border}`,
              paddingTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "12px 20px",
            }}
          >
            {headerFacts.map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 12, color: DD.subtle }}>{f.label}</span>
                <span style={{ fontWeight: 600 }}>{f.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs + panel */}
        <div style={{ background: DD.surface, ...panel, overflow: "hidden" }}>
          <div
            role="tablist"
            aria-label={t("disputes.workspaceShell.disputeSectionsAria")}
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 4,
              borderBottom: `1px solid ${DD.border}`,
              padding: "0 8px",
              // Horizontal scroll only: the active tab's -1px underline
              // overhang otherwise made the row scroll vertically and
              // painted stray scrollbar arrows beside the tabs.
              overflowX: "auto",
              overflowY: "hidden",
              scrollbarWidth: "none",
              whiteSpace: "nowrap",
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
                    padding: "12px 14px 10px",
                    marginBottom: -1,
                    fontSize: 13,
                    fontFamily: "inherit",
                    fontWeight: active ? 500 : 400,
                    color: active ? DD.primary : DD.subtle,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={props.tabs[props.activeTab]?.panelId}
            aria-labelledby={`${props.tabs[props.activeTab]?.id}-tab`}
            style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
          >
            {!onOverview ? (
              props.renderTab(props.activeTab)
            ) : (
              <>
                {/* Hero: outcome + executive summary + who responded */}
                <div
                  style={{
                    background: hero.bg,
                    border: `1px solid ${hero.border}`,
                    borderRadius: 8,
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div
                      aria-hidden="true"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: hero.tileBg,
                        color: hero.tileFg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                      }}
                    >
                      {lost ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 21V4" />
                          <path d="M4 4h12l-2 4 2 4H4" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
                          <path d="M9 12l2 2 4-4" />
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.2 }}>
                        {r(view.outcome.title)}
                      </div>
                      <div style={{ color: DD.subtle, lineHeight: 1.5, ...pretty }}>
                        {view.outcome.product
                          ? `${r(view.outcome.product)} · ${r(view.outcome.claim)}`
                          : r(view.outcome.claim)}
                      </div>
                      <span
                        style={{
                          alignSelf: "flex-start",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 2,
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: hero.chipBg,
                          fontSize: 11,
                          fontWeight: 600,
                          color: hero.chipFg,
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: hero.chipDot }} />
                        {r(view.outcome.chip)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        alignItems: "flex-end",
                        flex: "none",
                        marginLeft: "auto",
                      }}
                    >
                      <span style={{ fontSize: 12, color: DD.subtle }}>{r(view.outcome.amountLabel)}</span>
                      <span
                        style={{
                          fontSize: 22,
                          fontWeight: 700,
                          letterSpacing: "-0.015em",
                          fontVariantNumeric: "tabular-nums",
                          color: hero.amount,
                        }}
                      >
                        {fmtMoney(inputs.amount, inputs.currency)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      marginLeft: HERO_INDENT,
                      maxWidth: 720,
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "#344054",
                      ...pretty,
                    }}
                  >
                    {summary}
                  </div>
                  {/* The design's "Who responded:" line was removed at the
                      maintainer's request (2026-09-26): the summary paragraph
                      above already states who filed. The outcome email keeps it. */}
                </div>

                {/* What we saw / What carried the case */}
                {view.facts.items.length > 0 ? (
                  <div style={{ ...panel, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontWeight: 600 }}>{r(view.facts.title)}</span>
                      <span style={{ fontSize: 12, color: DD.subtle }}>{r(view.facts.sub)}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {view.facts.items.map((f, i) => {
                        const color = f.tone === "good" ? DD.success : DD.danger;
                        return (
                          <div key={i} style={softBox}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                border: `1.5px solid ${color}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flex: "none",
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                              <span style={{ fontWeight: 600, ...pretty }}>{r(f.title)}</span>
                              <span style={{ fontSize: 12, color: DD.subtle }}>{r(f.source)}</span>
                              {f.weighted ? (
                                <span
                                  style={{
                                    alignSelf: "flex-start",
                                    marginTop: 4,
                                    padding: "2px 8px",
                                    borderRadius: 6,
                                    background: "#EEF0F3",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: "#344054",
                                  }}
                                >
                                  {t("disputes.decidedView.facts.weightPill")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {view.facts.note ? (
                      <span style={{ fontSize: 12, color: DD.subtle, lineHeight: 1.55, ...pretty }}>
                        {r(view.facts.note)}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* What wins this type of dispute */}
                {view.checklist.length > 0 ? (
                  <div style={{ ...panel, overflow: "hidden" }}>
                    <div style={{ padding: "18px 18px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                          alignItems: "baseline",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{t("disputes.decidedView.checklist.title")}</span>
                        <span style={{ fontSize: 12, color: DD.subtle }}>{r(view.outcome.claim)}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {had}{" "}
                          <span style={{ color: "#98A2B3", fontWeight: 500 }}>/ {view.checklist.length}</span>
                        </span>
                        <span style={{ color: DD.subtle }}>{t("disputes.decidedView.checklist.coverage")}</span>
                      </div>
                      <div style={{ display: "flex", gap: 3, height: 8 }} aria-hidden="true">
                        {view.checklist.map((c, i) => (
                          <span key={i} style={{ flex: 1, borderRadius: 4, background: STATE[c.state].bar }} />
                        ))}
                      </div>
                    </div>
                    {view.checklist.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 18px",
                          borderTop: `1px solid ${DD.border}`,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: STATE[c.state].dot,
                              flex: "none",
                            }}
                          />
                          <span style={pretty}>{r(c.item)}</span>
                        </div>
                        <span
                          style={{
                            flex: "none",
                            padding: "2px 8px",
                            borderRadius: 6,
                            background: STATE[c.state].pillBg,
                            color: STATE[c.state].pillFg,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {r(c.label)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Next time — losses only */}
                {view.nextTime.length > 0 ? (
                  <div style={{ ...panel, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontWeight: 600 }}>{t("disputes.decidedView.next.title")}</span>
                      <span style={{ fontSize: 12, color: DD.subtle }}>{t("disputes.decidedView.next.sub")}</span>
                    </div>
                    {view.nextTime.map((n, i) => (
                      <div key={i} style={softBox}>
                        <span
                          style={{
                            flex: "none",
                            marginTop: 1,
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: DD.surface,
                            border: `1px solid ${DD.border}`,
                            fontSize: 11,
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: DD.subtle,
                          }}
                        >
                          {i + 1}
                        </span>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 600, ...pretty }}>{r(n.title)}</span>
                          {n.detail ? (
                            <span style={{ fontSize: 12, color: DD.subtle, lineHeight: 1.5, ...pretty }}>
                              {r(n.detail)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* What happened */}
                {view.timeline.length > 0 ? (
                  <div style={{ ...panel, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                    <span style={{ fontWeight: 600 }}>{t("disputes.decidedView.timeline.title")}</span>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {view.timeline.map((s, i) => {
                        const k = STEP[s.tone];
                        const last = i === view.timeline.length - 1;
                        return (
                          <div
                            key={i}
                            style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: "0 12px" }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                              <span
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  background: k.ring,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flex: "none",
                                }}
                              >
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: k.dot }} />
                              </span>
                              <span
                                style={{
                                  width: 1,
                                  flex: 1,
                                  background: DD.border,
                                  minHeight: 10,
                                  opacity: last ? 0 : 1,
                                }}
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "3px 0 16px" }}>
                              <span style={{ fontWeight: 600, color: k.title }}>{r(s.title)}</span>
                              <span style={{ fontSize: 12, color: DD.subtle, lineHeight: 1.5, ...pretty }}>
                                {s.detail ? `${fmtShort(s.at)} · ${r(s.detail)}` : fmtShort(s.at)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}

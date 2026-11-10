"use client";

/**
 * The dispute page (header + Overview / Evidence / Review and Forward) for an
 * open dispute with a prepared defence package, and for a lost or won dispute
 * DisputeDesk filed. A transcription of the design
 * (Claude Design project fca59ec9…, `NewDispute.dc.html`): every inline style
 * below is the design's, element by element.
 *
 * Every sentence on every tab is read from ONE `DisputeRecord`
 * (`lib/disputes/disputeRecord.ts`), so a fact is stated once, in the same
 * words, wherever it appears. Nothing here derives, scores or re-reads a fact.
 *
 * The bank-facing letter is NOT redrawn from the record: the Review tab shows
 * the real defence-package letter (`DefencePackageHtmlView`) in the design's
 * letter slot, unchanged.
 */

import { Button, Page } from "@shopify/polaris";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import { phaseLabel } from "@/lib/disputes/phaseUtils";
import type { StatusActionId, StatusCopy } from "@/lib/disputes/presentation/statusCopy";
import { withShopParams } from "@/lib/withShopParams";
import { ROLE_ORDER, type DisputeRecord, type HelpItem, type RecordItem, type RecordRole } from "@/lib/disputes/disputeRecord";
import type { RecordFormat } from "@/lib/disputes/recordFormat";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { TAB_INDEX } from "../workspace-components/types";
import { CardholderAcknowledgementCard } from "../tabs/sections/CardholderAcknowledgementCard";
import { DefencePackageHtmlView } from "../tabs/sections/DefencePackageHtmlView";
import { BankClaimCard } from "../tabs/sections/BankClaimCard";
import { ReturnRequestCard } from "../tabs/sections/ReturnRequestCard";
import { GorgiasCommsReviewSection } from "../tabs/sections/GorgiasCommsReviewSection";
import { MissingOrWeakSection } from "../tabs/sections/MissingOrWeakSection";
import { RegeneratePromptModal } from "../tabs/sections/RegeneratePromptModal";
import { PACK_LIMIT_REACHED, PackCreditNeededBanner } from "../tabs/sections/PackCreditNeededBanner";
import { useEvidenceSections } from "../tabs/useEvidenceSections";
import { LiabilityShiftPanel } from "@/components/liability-shift/LiabilityShiftPanel";
import {
  deriveDefencePackageActionState,
  deriveSubmitEffects,
} from "../tabs/sections/defencePackageActionState";
import type { DefencePackageRow } from "../tabs/sections/defencePackageRow";
import {
  BADGE,
  CHECK_STYLE,
  DD_TOKENS,
  PILL_STYLE,
  ROLE_STYLE,
  STEP_STYLE,
  TAB_OFF,
  TAB_ON,
  THEME,
} from "./recordStyles";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

interface Props {
  workspace: Workspace;
  record: DisputeRecord;
  fmt: RecordFormat;
  backUrl: string;
  headerTitle: string;
  reasonLabel: string;
  orderUrl: string | null;
  shopifyAdminUrl: string | null;
}

const SECTION_BOX: CSSProperties = {
  border: "1px solid var(--dd-border)",
  borderRadius: 8,
  padding: 18,
  display: "flex",
  flexDirection: "column",
};

/** States where something needs the merchant's attention: the hero shows the alert glyph (design: "Input needed"). Every other open state shows the clock. */
const ALERT_STATES: ReadonlySet<string> = new Set([
  "ask", "approval", "plan_limit", "attention", "save_failed", "build_failed", "build_paused",
]);

/** The design system Button, size md (40px), as inline style: `DisputeDeskUI.Button`. */
const BUTTON_BASE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 40,
  padding: "0 16px",
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 500,
  whiteSpace: "nowrap",
  cursor: "pointer",
  fontFamily: "inherit",
};
const BUTTON_SECONDARY: CSSProperties = { background: "#F1F5F9", color: "var(--dd-text)", border: "1px solid var(--dd-border)" };
const BUTTON_PRIMARY: CSSProperties = { background: "var(--dd-primary)", color: "#FFFFFF", border: 0 };

function Badge({ v, testId, children }: { v: { bg: string; fg: string; border: string }; testId?: string; children: ReactNode }) {
  return (
    <span
      data-testid={testId}
      style={{
        display: "inline-flex",
        flex: "none",
        whiteSpace: "nowrap",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 12,
        fontWeight: 500,
        lineHeight: "16px",
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
      }}
    >
      {children}
    </span>
  );
}

/** The four hero glyphs, as drawn in the design. */
function HeroIcon({ kind }: { kind: "clock" | "alert" | "check" | "flag" }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (kind === "clock")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2" {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  if (kind === "alert")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2" {...common} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
    );
  if (kind === "check")
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.2" {...common} aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="2" {...common} aria-hidden="true">
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

export default function RecordWorkspace({
  workspace,
  record,
  fmt,
  backUrl,
  headerTitle,
  reasonLabel,
  orderUrl,
  shopifyAdminUrl,
}: Props) {
  const t = useTranslations();
  const r = (tok: I18nToken) => resolveToken(t, tok) as string;
  const tab = workspace.clientState.activeTab;
  const searchParams = useSearchParams();
  const [ackOpen, setAckOpen] = useState(searchParams.get("section") === "cardholder-ack");
  const th = THEME[record.status];
  const decided = record.status !== "open";

  const tabs = [
    { id: "overview", label: t("disputes.workspaceShell.tabs.overview"), panelId: "overview-panel" },
    { id: "evidence", label: t("disputes.workspaceShell.tabs.evidence"), panelId: "evidence-panel" },
    { id: "submit", label: t("disputes.workspaceShell.tabs.reviewSubmit"), panelId: "submit-panel" },
  ];

  const { actions } = workspace;
  const onStatusAction = (id: StatusActionId) => {
    if (id === "decide:approved") return void actions.setReviewDecision("approve");
    if (id === "decide:conceded") return void actions.setReviewDecision("concede");
    if (id === "tab:evidence") return actions.setActiveTab(TAB_INDEX.evidence);
    if (id === "ack") return setAckOpen(true);
    if (id === "plans") return;
    // An ask: its card is on the Overview. Go there and bring it into view.
    if (tab !== TAB_INDEX.overview) actions.setActiveTab(TAB_INDEX.overview);
    setTimeout(() => document.getElementById(`dd-ask-${id.slice(4)}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  /* The header's date block (design: `dateTop` / `dateSub`): "Due today" / "5 days left" over "Deadline 10 Nov 2026"; decided: "Decided" over the date. */
  const dueToday = !decided && record.header.daysLeft === 0;
  const dateTop = decided
    ? t("disputes.record.ui.decidedTop")
    : dueToday
      ? t("disputes.record.ui.dueToday")
      : record.header.daysLeft !== null
        ? t("disputes.record.ui.daysLeft", { count: record.header.daysLeft })
        : null;
  const dateSub = decided
    ? record.header.decided
    : record.header.deadline
      ? t("disputes.record.ui.deadlineSub", { date: record.header.deadline })
      : null;
  const heroIcon: "clock" | "alert" | "check" | "flag" =
    record.status === "won" ? "check" : decided ? "flag" : ALERT_STATES.has(record.statusCopy.state) ? "alert" : "clock";
  const strengthBadge = record.hero.strengthBand
    ? BADGE[record.hero.strengthBand === "strong" ? "success" : record.hero.strengthBand === "moderate" ? "warning" : "default"]
    : null;

  const helpItems = record.help?.items ?? [];
  const firstHelp = helpItems[0] ?? null;
  const onHelpAction = (kind: "ack") => {
    if (kind === "ack") setAckOpen(true);
  };

  const ack = ackOpen ? <CardholderAcknowledgementCard workspace={workspace} startExpanded /> : null;

  return (
    <Page backAction={{ content: t("disputes.backToDisputes"), url: backUrl }}>
      <style>{`.ddr,.ddr *{box-sizing:border-box}.ddr p,.ddr h2{margin:0}.ddr button{font:inherit}`}</style>
      <div
        className="ddr"
        data-testid="dispute-record-page"
        style={{
          ...DD_TOKENS,
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          color: "var(--dd-text)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          width: "100%",
          fontSize: 13,
        }}
      >
        {/* Header (design: Dispute Detail.dc.html, the first card) */}
        <div
          data-help-guide="detail-header"
          style={{ background: "var(--dd-surface)", border: "1px solid var(--dd-border)", borderRadius: 12, overflow: "hidden" }}
        >
          <div
            style={{ padding: "24px 28px", display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "space-between", alignItems: "flex-start" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {record.header.orderName ? (
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--dd-text-subtle)" }}>
                    {orderUrl ? (
                      <a href={orderUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                        {t("disputes.record.ui.orderLabel", { order: record.header.orderName })}
                      </a>
                    ) : (
                      t("disputes.record.ui.orderLabel", { order: record.header.orderName })
                    )}
                  </div>
                ) : null}
                <h1
                  title={headerTitle}
                  style={{ margin: 0, fontSize: 24, lineHeight: 1.25, fontWeight: 600, letterSpacing: "-0.01em", textWrap: "pretty" } as CSSProperties}
                >
                  {reasonLabel}
                </h1>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <Badge testId="dispute-phase-pill" v={BADGE.warning}>
                  {phaseLabel(record.phase, t)}
                </Badge>
                <Badge v={{ bg: th.chipBg, fg: th.chipFg, border: th.chipBorder }}>{r(record.hero.statusChip)}</Badge>
                {record.hero.strengthBand && strengthBadge ? (
                  <Badge testId="dispute-strength-pill" v={strengthBadge}>
                    {t(`presentation.strength.detail.${record.hero.strengthBand}`)}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "none", whiteSpace: "nowrap" }}>
              {dateTop ? (
                <div
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, paddingRight: 16, borderRight: "1px solid var(--dd-border)" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: dueToday ? "#B45309" : "var(--dd-text)" }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: dueToday ? "var(--dd-warning)" : decided ? "var(--dd-text-muted)" : "var(--dd-primary)",
                      }}
                    />
                    {dateTop}
                  </div>
                  {dateSub ? <div style={{ fontSize: 13, color: "var(--dd-text-subtle)" }}>{dateSub}</div> : null}
                </div>
              ) : null}
              {shopifyAdminUrl ? (
                <a
                  href={shopifyAdminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...BUTTON_BASE, ...BUTTON_SECONDARY, textDecoration: "none" }}
                >
                  {t("disputes.overviewExtra.viewInShopify")} ↗
                </a>
              ) : (
                <span
                  title={t("disputes.overviewExtra.viewInShopifyUnavailable")}
                  style={{ ...BUTTON_BASE, ...BUTTON_SECONDARY, opacity: 0.5, cursor: "not-allowed" }}
                >
                  {t("disputes.overviewExtra.viewInShopify")} ↗
                </span>
              )}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              borderTop: "1px solid var(--dd-border)",
              background: "#FBFCFE",
              marginRight: -1,
            }}
          >
            {[
              [t("disputes.record.ui.factAmount"), record.header.amount],
              [t("disputes.record.ui.factCustomer"), record.header.customer ?? "—"],
              [t("disputes.record.ui.factOpened"), record.header.opened ?? "—"],
              [t("disputes.record.ui.factReason"), reasonLabel],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{ padding: "16px 28px", display: "flex", flexDirection: "column", gap: 4, boxShadow: "inset -1px 0 0 var(--dd-border)" }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--dd-text-muted)" }}>
                  {label}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--dd-text)" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab card */}
        <div style={{ background: "var(--dd-surface)", border: "1px solid var(--dd-border)", borderRadius: 12, overflow: "hidden" }}>
          <div
            role="tablist"
            aria-label={t("disputes.workspaceShell.disputeSectionsAria")}
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 4,
              backgroundImage: "linear-gradient(var(--dd-border), var(--dd-border))",
              backgroundRepeat: "no-repeat",
              backgroundSize: "100% 1px",
              backgroundPosition: "left bottom",
              padding: "0 20px",
              overflowX: "auto",
              overflowY: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {tabs.map((x, index) => {
              const on = tab === index;
              return (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  id={`${x.id}-tab`}
                  aria-selected={on}
                  aria-controls={x.panelId}
                  data-help-guide={`detail-tab-${x.id}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => workspace.actions.setActiveTab(index as 0 | 1 | 2)}
                  style={{
                    appearance: "none",
                    background: "transparent",
                    borderTop: 0,
                    borderLeft: 0,
                    borderRight: 0,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    lineHeight: "inherit",
                    ...(on ? TAB_ON : TAB_OFF),
                  }}
                >
                  {x.label}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={tabs[tab]?.panelId}
            aria-labelledby={`${tabs[tab]?.id}-tab`}
            style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}
          >
            {/* Hero: the account */}
            <div style={{ borderRadius: 12, background: th.bg, border: `1px solid ${th.border}`, overflow: "hidden" }}>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "space-between", alignItems: "flex-start", padding: "24px 28px" }}
              >
                <div style={{ display: "flex", gap: 16, minWidth: 0, flex: "1 1 480px" }}>
                  <div
                    style={{
                      flex: "none",
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: "var(--dd-surface)",
                      border: `1px solid ${th.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: th.icon,
                    }}
                  >
                    <HeroIcon kind={heroIcon} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <h2
                      style={{ margin: 0, fontSize: 21, lineHeight: 1.3, fontWeight: 600, letterSpacing: "-0.01em", textWrap: "pretty" } as CSSProperties}
                    >
                      {r(record.statusCopy.headline)}
                    </h2>
                    <div style={{ fontSize: 13, color: "#475467" }}>{r(record.statusCopy.subline)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "#475467" }}>{r(record.hero.amountLabel)}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: th.amount, whiteSpace: "nowrap" }}>
                    {record.header.amount}
                  </div>
                </div>
              </div>
              <div style={{ height: 1, background: th.border, margin: "0 28px" }} />
              <div style={{ display: "flex", flexDirection: "column", padding: "8px 28px" }}>
                <StatusParts
                  copy={record.statusCopy}
                  r={r}
                  onAction={onStatusAction}
                  plansUrl={withShopParams("/app/billing", searchParams)}
                  busy={actions.reviewSaving === true}
                  rule={th.border}
                />
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475467", padding: "14px 28px", borderTop: `1px solid ${th.border}` }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                {t("disputes.record.ui.forYouOnly")}
              </div>
            </div>

            <PackBanners workspace={workspace} t={t} />
            {/* While the hero itself asks for the approval (its Approve / Don't add buttons) this row would repeat them. */}
            {/* Not while nothing could be filed: with no response (skipped / nothing to argue) "save it on the deadline" and "add no package" decide nothing. */}
            {record.canDecide && record.statusCopy.state !== "approval" && record.statusCopy.state !== "nothing_to_argue" ? (
              <DecisionRow workspace={workspace} record={record} t={t} />
            ) : null}

            {tab === TAB_INDEX.overview ? (
              <OverviewBody
                workspace={workspace}
                record={record}
                fmt={fmt}
                r={r}
                t={t}
                help={record.help && helpItems.length > 0 ? { title: r(record.help.title), items: helpItems } : null}
                onHelpAction={onHelpAction}
                ack={ack}
              />
            ) : null}
            {tab === TAB_INDEX.evidence ? (
              <EvidenceBody workspace={workspace} record={record} r={r} t={t} firstHelp={firstHelp} onHelpAction={onHelpAction} ack={ack} />
            ) : null}
            {tab === TAB_INDEX.reviewForward ? <ReviewBody workspace={workspace} record={record} r={r} t={t} /> : null}
          </div>
        </div>
      </div>
    </Page>
  );
}

type T = ReturnType<typeof useTranslations>;
type R = (tok: I18nToken) => string;

/* ── Overview ── */

function OverviewBody({
  workspace,
  record,
  fmt,
  r,
  t,
  help,
  onHelpAction,
  ack,
}: {
  workspace: Workspace;
  record: DisputeRecord;
  fmt: RecordFormat;
  r: R;
  t: T;
  help: { title: string; items: HelpItem[] } | null;
  onHelpAction: (kind: "ack") => void;
  ack: ReactNode;
}) {
  const items = new Map(record.items.map((x) => [x.key, x]));
  const cl = record.checklist;
  const requiredAskIds = new Set(
    (workspace.data?.asks ?? []).filter((a) => a.priority === "required" && a.offered && a.pending).map((a) => a.id),
  );
  return (
    <>
      {help && record.status !== "open" ? (
        /* The design's "Next time" card (decided disputes): a titled box of plain tips. */
        <div style={{ border: "1px solid var(--dd-border)", borderRadius: 12, padding: "20px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{help.title}</div>
          {help.items.map((n, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "14px 16px", borderRadius: 8, background: "var(--dd-bg)" }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r(n.title)}</div>
              <div style={{ fontSize: 14, color: "#475467" }}>{r(n.detail)}</div>
            </div>
          ))}
        </div>
      ) : null}
      {help && record.status === "open" ? (
        <div style={{ ...SECTION_BOX, gap: 12 }}>
          <strong>{help.title}</strong>
          {help.items.map((n, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: "12px 14px",
                background: "#F6F8FB",
                border: "1px solid #E8ECF2",
                borderRadius: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "1px solid var(--dd-border)",
                  background: "#FFFFFF",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                {i + 1}
              </span>
              <div style={{ flex: "1 1 240px", display: "flex", flexDirection: "column", gap: 2 }}>
                <strong>{r(n.title)}</strong>
                <span
                  style={{ fontSize: 12, color: "var(--dd-text-subtle)", lineHeight: 1.5, textWrap: "pretty" } as CSSProperties}
                >
                  {r(n.detail)}
                </span>
              </div>
              {n.action ? (
                <PrimaryAction label={r(n.action.label)} onClick={() => onHelpAction(n.action!.kind)} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {ack}

      <div id="dd-ask-bank_claim">
        <BankClaimCard workspace={workspace} />
      </div>
      {/* The other required asks, from the registry (lib/disputes/merchantAsks): the same cards the Evidence tab renders, so the first screen shows what the hero asks for. */}
      {requiredAskIds.has("return_request") ? (
        <div id="dd-ask-return_request">
          <ReturnRequestCard workspace={workspace} />
        </div>
      ) : null}
      <LiabilityShiftPanel disputeId={workspace.data?.dispute?.id ?? ""} />

      {record.recordRows.length > 0 ? (
      <div style={{ ...SECTION_BOX, gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <strong>{t("disputes.record.ui.recordTitle")}</strong>
          <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{t("disputes.record.ui.recordSub")}</span>
        </div>
        {record.recordRows.map((row) => {
          const it = row === "amounts" ? null : items.get(row);
          const label = row === "amounts" ? t("disputes.record.item.amounts.label") : it ? r(it.label) : "";
          const text = row === "amounts" ? r(record.facts.amounts as I18nToken) : it ? r(it.detail) : "";
          const source = row === "amounts" ? t("disputes.record.source.timeline") : it ? r(it.source) : "";
          const roleKey: RecordRole | "record" = row === "amounts" || !it ? "record" : it.role;
          return (
            <div
              key={row}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 12,
                alignItems: "start",
                padding: "12px 14px",
                background: "#F6F8FB",
                border: "1px solid #E8ECF2",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{label}</span>
                <span
                  style={{ fontWeight: 600, lineHeight: 1.45, textWrap: "pretty", overflowWrap: "anywhere" } as CSSProperties}
                >
                  {text}
                </span>
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{t("disputes.record.ui.from", { source })}</span>
              </div>
              {row === "amounts" || record.showRoles ? (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: ROLE_STYLE[roleKey].bg,
                  color: ROLE_STYLE[roleKey].fg,
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {t(`disputes.record.role.${roleKey}`)}
              </span>
              ) : null}
            </div>
          );
        })}
      </div>
      ) : null}

      {cl.total > 0 ? (
        <div style={{ border: "1px solid var(--dd-border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "18px 18px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong>{t("disputes.record.ui.winsTitle")}</strong>
              <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{r(record.hero.claimShort)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>
                {cl.had} <span style={{ color: "#98A2B3", fontWeight: 500 }}>/ {cl.total}</span>
              </span>
              <span style={{ color: "var(--dd-text-subtle)" }}>{t("disputes.record.ui.coverageOf")}</span>
            </div>
            <div style={{ display: "flex", gap: 3, height: 8 }}>
              {cl.rows.map((k) => (
                <span key={k.id} style={{ flex: 1, borderRadius: 4, background: CHECK_STYLE[k.state][1] }} />
              ))}
            </div>
            {cl.odds ? <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{r(cl.odds)}</span> : null}
            {cl.note ? (
              <span
                style={{
                  fontSize: 12.5,
                  color: "#344054",
                  lineHeight: 1.55,
                  background: "#F6F8FB",
                  border: "1px solid #E8ECF2",
                  borderRadius: 8,
                  padding: "10px 12px",
                  textWrap: "pretty",
                } as CSSProperties}
              >
                {r(cl.note)}
              </span>
            ) : null}
          </div>
          {cl.rows.map((k) => (
            <div
              key={k.id}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 12,
                padding: "12px 18px",
                borderTop: "1px solid var(--dd-border)",
                alignItems: "start",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: CHECK_STYLE[k.state][0], marginTop: 5, flex: "none" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{r(k.item)}</span>
                  {k.sub ? (
                    <span style={{ fontSize: 12, color: "var(--dd-text-subtle)", textWrap: "pretty" } as CSSProperties}>
                      {r(k.sub)}
                    </span>
                  ) : null}
                </div>
              </div>
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: CHECK_STYLE[k.state][2],
                  color: CHECK_STYLE[k.state][3],
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {r(k.label)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ ...SECTION_BOX, gap: 14 }}>
        <strong>{r(record.timelineTitle)}</strong>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {record.timeline.map((s, i, arr) => {
            const st = STEP_STYLE[s.kind];
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: "0 12px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: st[0],
                      border: `1px solid ${st[1]}`,
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: st[2] }} />
                  </span>
                  <span
                    style={{
                      width: 1,
                      flex: 1,
                      background: "var(--dd-border)",
                      minHeight: 10,
                      opacity: i === arr.length - 1 ? 0 : 1,
                    }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "3px 0 16px" }}>
                  <span style={{ fontWeight: 600, color: st[3] }}>{r(s.title)}</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--dd-text-subtle)",
                      lineHeight: 1.5,
                      textWrap: "pretty",
                      overflowWrap: "anywhere",
                    } as CSSProperties}
                  >
                    {fmt.date(s.at)} · {r(s.text)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function PrimaryAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...BUTTON_BASE, ...BUTTON_PRIMARY }}>
      {label}
    </button>
  );
}

/** The labelled parts of the status block (`record.statusCopy`). Renders tokens only; every sentence was composed in lib/.
 *  Layout is the design's section rows: an uppercase label beside the lines, a rule between rows, and the
 *  merchant's own ask raised in a white box with its button. */
function StatusParts({
  copy,
  r,
  onAction,
  plansUrl,
  busy,
  rule,
}: {
  copy: StatusCopy;
  r: R;
  onAction: (id: StatusActionId) => void;
  plansUrl: string;
  busy: boolean;
  rule: string;
}) {
  return (
    <div data-testid="dispute-record-account" style={{ display: "flex", flexDirection: "column" }}>
      {copy.parts.map((p, i) => {
        const emphasis = p.kind === "need" && p.actions.length > 0;
        return (
          <div
            key={p.kind}
            data-part={p.kind}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(140px, 190px) minmax(0, 1fr)",
              columnGap: 24,
              rowGap: 6,
              padding: "16px 0",
              borderTop: i ? `1px solid ${rule}` : "none",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#475467", paddingTop: 2 }}>
              {r(p.label)}
            </div>
            <div
              style={
                emphasis
                  ? {
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "16px 18px",
                      margin: "-4px 0",
                      background: "var(--dd-surface)",
                      border: "1px solid #C7D5F8",
                      borderRadius: 10,
                    }
                  : { display: "flex", flexDirection: "column", gap: 6 }
              }
            >
              {p.lines.map((line, idx) => (
                <p key={idx} style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--dd-text)", textWrap: "pretty" } as CSSProperties}>
                  {r(line)}
                </p>
              ))}
              {p.actions.length > 0 ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 6 }}>
                  {p.actions.map((a) =>
                    a.id === "plans" ? (
                      <Button key={a.id} variant="primary" url={plansUrl}>
                        {r(a.label)}
                      </Button>
                    ) : a.id === "decide:conceded" ? (
                      <button
                        key={a.id}
                        type="button"
                        disabled={busy}
                        onClick={() => onAction(a.id)}
                        style={{ ...BUTTON_BASE, ...BUTTON_SECONDARY }}
                      >
                        {r(a.label)}
                      </button>
                    ) : (
                      <span key={a.id} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <PrimaryAction label={r(a.label)} onClick={() => onAction(a.id)} />
                        {a.meta ? <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{r(a.meta)}</span> : null}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Evidence ── */

function EvidenceBody({
  workspace,
  record,
  r,
  t,
  firstHelp,
  onHelpAction,
  ack,
}: {
  workspace: Workspace;
  record: DisputeRecord;
  r: R;
  t: T;
  firstHelp: HelpItem | null;
  onHelpAction: (kind: "ack") => void;
  ack: ReactNode;
}) {
  const open = record.status === "open";
  const groups = ROLE_ORDER.map((role) => ({ role, rows: record.items.filter((x) => x.role === role) }));
  return (
    <>
      {open && firstHelp ? (
        <div
          style={{
            background: "#EFF4FF",
            border: "1px solid #C7D7FE",
            borderRadius: 12,
            padding: 18,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#1D4ED8" }}>
              {t("disputes.record.ui.strengthenEyebrow")}
            </span>
            <strong style={{ fontSize: 15 }}>{r(firstHelp.title)}</strong>
            <span style={{ color: "#344054", lineHeight: 1.5, textWrap: "pretty" } as CSSProperties}>{r(firstHelp.detail)}</span>
          </div>
          {firstHelp.action ? (
            <PrimaryAction label={r(firstHelp.action.label)} onClick={() => onHelpAction(firstHelp.action!.kind)} />
          ) : null}
        </div>
      ) : null}
      {open ? ack : null}
      <EvidenceActions workspace={workspace} />
      {record.showRoles ? (
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{t("disputes.record.ui.evidenceByRole")}</h2>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "0 0 12px", lineHeight: 1.5, textWrap: "pretty" } as CSSProperties}>
          {r(record.facts.roles as I18nToken)}
        </p>
        <div style={{ display: "flex", height: 8, gap: 2, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
          {ROLE_ORDER.map((role) => (
            <span key={role} style={{ flex: record.counts[role], background: ROLE_STYLE[role].dot }} />
          ))}
        </div>
        {groups.map(({ role, rows }) => (
          <div key={role} style={{ paddingTop: 14, marginTop: 10, borderTop: "1px solid #E1E3E5" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: ROLE_STYLE[role].bg,
                color: ROLE_STYLE[role].fg,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_STYLE[role].dot }} />
              {t(`disputes.record.role.${role}`)} · {rows.length}
            </span>
            <p style={{ fontSize: 12.5, color: "#6D7175", margin: "6px 0 8px", textWrap: "pretty" } as CSSProperties}>
              {t(`disputes.record.roleCap.${role}`)}
            </p>
            {rows.map((row) => (
              <EvidenceRow key={row.key} row={row} r={r} t={t} />
            ))}
          </div>
        ))}
      </div>
      ) : null}
    </>
  );
}

function EvidenceRow({ row, r, t }: { row: RecordItem; r: R; t: T }) {
  const pill = row.strength ? PILL_STYLE[row.strength] : null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 12,
        padding: "12px 0",
        borderTop: "1px dashed #EBEBEB",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{r(row.label)}</p>
        <p
          style={{ fontSize: 12.5, color: "#4B5563", lineHeight: 1.5, margin: "4px 0 0", textWrap: "pretty", overflowWrap: "anywhere" } as CSSProperties}
        >
          {r(row.detail)}
        </p>
        <p style={{ fontSize: 11, color: "#6D7175", margin: "6px 0 0" }}>{t("disputes.record.ui.from", { source: r(row.source) })}</p>
      </div>
      {row.strength && pill ? (
        <span
          style={{
            alignSelf: "start",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            background: pill[0],
            color: pill[1],
          }}
        >
          {t(`disputes.record.ui.pill.${row.strength.toLowerCase()}`)}
        </span>
      ) : null}
    </div>
  );
}

/* ── Review and Forward ── */

function ReviewBody({ workspace, record, r, t }: { workspace: Workspace; record: DisputeRecord; r: R; t: T }) {
  const { data, actions } = workspace;
  const [busy, setBusy] = useState<"submit" | "finalize" | "regenerate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dp = data?.defencePackage;
  const latest = (dp?.latest ?? null) as DefencePackageRow | null;
  const bankFacing = (dp?.bankFacing ?? null) as DefencePackageRow | null;
  const decided = record.status !== "open";
  const saved = record.stage === "saved" || record.stage === "under_review";
  const displayRow = decided || saved ? (bankFacing ?? latest) : latest;
  const canRetry = record.stage === "failed" || record.stage === "no_pack";
  const shopId = data?.dispute?.shopId ?? null;
  const qs = shopId ? `?shop_id=${encodeURIComponent(shopId)}` : "";
  const pdfHref = displayRow?.pdf_path
    ? (displayRow.preview_url ?? `/api/defence-packages/${displayRow.id}/preview${qs}`)
    : null;

  const actionState = useMemo(
    () =>
      latest
        ? deriveDefencePackageActionState({
            rowStatus: latest.status,
            rowValidationStatus: latest.validation_status,
            rowPdfPath: latest.pdf_path,
            latestStatus: latest.status,
            rowPromptVersion: latest.prompt_version,
            currentPromptVersion: dp?.currentPromptVersion ?? null,
            hasActionableDraft: true,
            hasUnsubmittedDraft: false,
            hasLatest: true,
            hasBankFacing: !!bankFacing,
            isNetworkSubmitted: false,
            isClosed: false,
            submitPending: busy === "submit",
            safety: dp?.safety,
          })
        : null,
    [latest, bankFacing, dp?.currentPromptVersion, dp?.safety, busy],
  );
  const open = !decided && !saved;
  // An unassessed case is never offered a filing action (lib/disputes/assessmentPresence).
  const mayFile = workspace.derived.assessment.mayOfferFilingAction;
  const canSaveNow = open && mayFile && !!latest && actionState?.canSubmit === true;
  const canApprove = open && mayFile && !!latest && actionState?.canFinalize === true && record.stage !== "prepared";
  const canRegenerate = open && !!latest && actionState?.canRegenerate === true;

  async function act(kind: "submit" | "finalize" | "regenerate") {
    if (!latest || busy) return;
    setError(null);
    setBusy(kind);
    try {
      const res = await fetch(`/api/defence-packages/${latest.id}/${kind}${qs}`, { method: "POST" });
      let body: { error?: unknown; code?: unknown; message?: unknown } | null = null;
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // Non-JSON body: the fallback message covers it.
      }
      if (kind === "submit") {
        const effects = deriveSubmitEffects(
          { ok: res.ok, status: res.status, body },
          t("disputes.reviewTab.package.errors.submitFailed", { status: res.status }),
        );
        if (effects.error) setError(effects.error);
        if (effects.notifySubmitted) actions.markJustSubmitted();
      } else if (!res.ok) {
        setError(typeof (body as { error?: unknown } | null)?.error === "string" ? String((body as unknown as { error: string }).error) : t("disputes.reviewTab.package.errors.submitFailed", { status: res.status }));
      }
      await actions.fetchAll();
    } finally {
      setBusy(null);
    }
  }

  const buttonStyle: CSSProperties = {
    background: "#FFFFFF",
    boxShadow: "0 0 0 1px #E3E3E3, 0 1px 0 #B5B5B5",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 550,
    border: 0,
    color: "inherit",
    textDecoration: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  };

  const d = data?.dispute;
  const letterDispute = d
    ? {
        shopId: d.shopId ?? null,
        disputeGid: d.disputeGid ?? null,
        orderName: d.orderName ?? null,
        reason: d.reason ?? null,
        amount: d.amount ?? null,
        currencyCode: d.currency ?? null,
        cardNetwork: d.cardNetwork ?? null,
        paymentFamily: d.paymentFamily ?? null,
        paymentLabel: d.paymentLabel ?? null,
        phase: d.phase ?? null,
        cardLast4: d.cardLast4 ?? null,
        transactionDate: d.transactionDate ?? null,
        openedAt: d.openedAt ?? null,
        paymentGateway: d.paymentGateway ?? null,
        financialStatus: d.financialStatus ?? null,
        fulfillmentStatus: d.fulfillmentStatus ?? null,
        cardholderName: d.cardholderName ?? d.customerName ?? null,
        shopName: d.merchantDomain ?? d.shopDomain ?? null,
        merchantName: d.merchantDomain ?? d.shopDomain ?? null,
        dueAt: d.dueAt ?? null,
        timelineEvents: d.timelineEvents ?? undefined,
      }
    : undefined;

  const groups = ROLE_ORDER.map((role) => ({ role, rows: record.items.filter((x) => x.role === role) }));

  return (
    <>
      <div
        style={{
          background: "#F6F6F7",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{t("disputes.record.ui.pkgTitle")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.55 }}>
          {record.pkg.lines.map((k, idx) => (
            <span key={k} style={idx === 0 ? { fontWeight: 600 } : { color: "#344054" }}>
              {r(record.facts[k] as I18nToken)}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canSaveNow ? (
            <button type="button" onClick={() => void act("submit")} disabled={busy !== null} style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}>
              {busy === "submit" ? t("disputes.record.ui.saving") : t("disputes.record.ui.saveNow")}
            </button>
          ) : null}
          {canApprove ? (
            <button type="button" onClick={() => void act("finalize")} disabled={busy !== null} style={buttonStyle}>
              {t("disputes.record.ui.approve")}
            </button>
          ) : null}
          {pdfHref ? (
            <a href={pdfHref} target="_blank" rel="noopener noreferrer" style={buttonStyle}>
              {t("disputes.record.ui.viewPdf")}
            </a>
          ) : null}
          {canRegenerate ? (
            <button type="button" onClick={() => void act("regenerate")} disabled={busy !== null} style={buttonStyle}>
              {t("disputes.record.ui.regenerate")}
            </button>
          ) : null}
          {canRetry ? (
            <button type="button" onClick={() => void actions.generatePack()} disabled={workspace.clientState.retrying} style={buttonStyle}>
              {t("disputes.record.ui.retryBuild")}
            </button>
          ) : null}
        </div>
        {error ? <span style={{ color: "#B42318", fontSize: 12 }}>{error}</span> : null}
      </div>

      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#6D7175" }}>
          {t("disputes.record.ui.letterEyebrow")}
        </span>
        {displayRow && displayRow.narrative_json ? (
          <DefencePackageHtmlView row={displayRow} dispute={letterDispute} />
        ) : (
          <span style={{ color: "#6D7175" }}>{t("disputes.record.ui.noLetter")}</span>
        )}
      </div>

      {record.showRoles ? (
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <strong style={{ fontSize: 16 }}>{t("disputes.record.ui.reachesBank")}</strong>
        <span style={{ fontSize: 12.5, color: "#6D7175", textWrap: "pretty" } as CSSProperties}>
          {r(record.facts.roles as I18nToken)} {t("disputes.record.ui.reachesBankNote")}
        </span>
        {groups.map(({ role, rows }) => (
          <div
            key={role}
            style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", borderTop: "1px solid #EBEBEB", paddingTop: 10 }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: ROLE_STYLE[role].bg,
                color: ROLE_STYLE[role].fg,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROLE_STYLE[role].dot }} />
              {t(`disputes.record.role.${role}`)} · {rows.length}
            </span>
            <span style={{ flex: "1 1 220px", color: "#344054", lineHeight: 1.6 }}>{rows.map((x) => r(x.label)).join(" · ")}</span>
          </div>
        ))}
      </div>
      ) : null}
    </>
  );
}

/* ── Controls that have no slot in the design, kept in the nearest place ── */

/** Build failure / pack credit, shown under the account while it applies. */
function PackBanners({ workspace, t }: { workspace: Workspace; t: T }) {
  const { derived, clientState, actions } = workspace;
  if (derived.failureCode === PACK_LIMIT_REACHED) {
    return (
      <PackCreditNeededBanner
        onRetry={() => {
          void actions.generatePack();
        }}
        retrying={clientState.retrying}
      />
    );
  }
  void t;
  return null;
}

/** The merchant's standing decision (review state): save on the deadline, or add no package. */
function DecisionRow({ workspace, record, t }: { workspace: Workspace; record: DisputeRecord; t: T }) {
  const { actions } = workspace;
  const saving = actions.reviewSaving === true;
  const options: Array<{ key: "approve" | "concede"; label: string; on: boolean }> = [
    { key: "approve", label: t("disputes.record.ui.decideSave"), on: record.decision === "approved" },
    { key: "concede", label: t("disputes.record.ui.decideNone"), on: record.decision === "conceded" },
  ];
  return (
    <div style={{ ...SECTION_BOX, gap: 10 }}>
      <strong>{t("disputes.record.ui.decideTitle")}</strong>
      <div role="radiogroup" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={o.on}
            disabled={saving}
            onClick={() => actions.setReviewDecision(o.key)}
            style={{
              borderRadius: 8,
              padding: "6px 12px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "inherit",
              border: `1px solid ${o.on ? "#1D4ED8" : "var(--dd-border)"}`,
              background: o.on ? "#EFF4FF" : "#FFFFFF",
              color: o.on ? "#1D4ED8" : "inherit",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Evidence tab controls: return confirmation, Gorgias review, upload / waive. */
function EvidenceActions({ workspace }: { workspace: Workspace }) {
  const { data, clientState, actions } = workspace;
  const sections = useEvidenceSections(workspace);
  const isWindowClosed = data?.dispute?.submissionState === "submitted_confirmed";
  return (
    <>
      <ReturnRequestCard workspace={workspace} />
      {data?.dispute?.id ? <GorgiasCommsReviewSection workspace={workspace} disputeId={data.dispute.id} /> : null}
      <MissingOrWeakSection
        items={sections.missingOrWeak}
        uploadingField={clientState.uploadingField}
        focusField={clientState.focusField}
        onFocusCleared={actions.clearFocus}
        uploadsDisabled={isWindowClosed}
        onUpload={(field, files) => {
          void actions.uploadEvidence(field, files);
        }}
        onWaive={(field, reason) => {
          void actions.waiveItem(field, reason);
        }}
      />
      <RegeneratePromptModal
        open={clientState.pendingRegeneratePrompt !== null}
        mode={data?.appliedRule?.mode ?? null}
        submitting={clientState.regenerateSubmitting}
        error={clientState.regenerateError}
        onConfirm={() => {
          void actions.regeneratePack();
        }}
        onCancel={() => actions.dismissRegeneratePrompt()}
      />
    </>
  );
}

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

import { Page } from "@shopify/polaris";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { resolveToken } from "@/lib/i18n/resolveToken";
import type { I18nToken } from "@/lib/i18n/token";
import { phaseLabel } from "@/lib/disputes/phaseUtils";
import { STRENGTH_CHIP } from "@/lib/disputes/presentation/uiTokens";
import { ROLE_ORDER, type DisputeRecord, type HelpItem, type RecordItem, type RecordRole } from "@/lib/disputes/disputeRecord";
import type { RecordFormat } from "@/lib/disputes/recordFormat";
import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { TAB_INDEX } from "../workspace-components/types";
import { CardholderAcknowledgementCard } from "../tabs/sections/CardholderAcknowledgementCard";
import { DefencePackageHtmlView } from "../tabs/sections/DefencePackageHtmlView";
import { BankClaimCard } from "../tabs/sections/BankClaimCard";
import { ParcelOutcomeCard } from "../tabs/sections/ParcelOutcomeCard";
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

  const account = record.account.map((k) => r(record.facts[k] as I18nToken)).join(" ");
  const metaValue = decided
    ? record.header.decided ?? ""
    : [
        record.header.deadline,
        record.header.daysLeft !== null ? t("disputes.record.ui.daysLeft", { count: record.header.daysLeft }) : null,
      ]
        .filter(Boolean)
        .join(" · ");

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
          gap: 16,
          width: "100%",
          fontSize: 13,
        }}
      >
        {/* Header */}
        <div
          data-help-guide="detail-header"
          style={{
            background: "var(--dd-surface)",
            border: "1px solid var(--dd-border)",
            borderRadius: 8,
            padding: "20px 18px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", textWrap: "pretty" } as CSSProperties}>
                {orderUrl ? (
                  <a href={orderUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                    {headerTitle}
                  </a>
                ) : (
                  headerTitle
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span
                  data-testid="dispute-phase-pill"
                  style={{ borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 500, background: "#FEF3C7", color: "#92400E" }}
                >
                  {phaseLabel(record.phase, t)}
                </span>
                <span
                  style={{ borderRadius: 6, padding: "4px 8px", fontSize: 12, fontWeight: 500, background: th.chipBg, color: th.chipFg }}
                >
                  {r(record.hero.statusChip)}
                </span>
                {record.hero.strengthBand ? (
                  <span
                    data-testid="dispute-strength-pill"
                    style={{
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                      fontWeight: 500,
                      background: STRENGTH_CHIP[record.hero.strengthBand].bg,
                      color: STRENGTH_CHIP[record.hero.strengthBand].fg,
                    }}
                  >
                    {t(`presentation.strength.detail.${record.hero.strengthBand}`)}
                  </span>
                ) : null}
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>
                  <strong style={{ color: "var(--dd-text)", fontWeight: 600 }}>
                    {t(decided ? "disputes.record.ui.decided" : "disputes.record.ui.deadline")}
                  </strong>{" "}
                  {metaValue}
                </span>
              </div>
            </div>
            {shopifyAdminUrl ? (
              <a
                href={shopifyAdminUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 32,
                  padding: "0 12px",
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 8,
                  background: "#F1F5F9",
                  border: "1px solid var(--dd-border)",
                  whiteSpace: "nowrap",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                {t("disputes.overviewExtra.viewInShopify")}
              </a>
            ) : (
              <span
                title={t("disputes.overviewExtra.viewInShopifyUnavailable")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 32,
                  padding: "0 12px",
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 8,
                  background: "#F1F5F9",
                  border: "1px solid var(--dd-border)",
                  whiteSpace: "nowrap",
                  opacity: 0.5,
                  cursor: "not-allowed",
                }}
              >
                {t("disputes.overviewExtra.viewInShopify")}
              </span>
            )}
          </div>
          <div
            style={{
              borderTop: "1px solid var(--dd-border)",
              paddingTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "12px 20px",
            }}
          >
            {[
              [t("disputes.record.ui.factAmount"), record.header.amount],
              [t("disputes.record.ui.factCustomer"), record.header.customer ?? "—"],
              [t("disputes.record.ui.factOpened"), record.header.opened ?? "—"],
              [t("disputes.record.ui.factReason"), reasonLabel],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tab card */}
        <div style={{ background: "var(--dd-surface)", border: "1px solid var(--dd-border)", borderRadius: 8, overflow: "hidden" }}>
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
              padding: "0 8px",
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
                    fontSize: "inherit",
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
            style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}
          >
            {/* Hero: the account */}
            <div
              style={{
                background: th.bg,
                border: `1px solid ${th.border}`,
                borderRadius: 8,
                padding: 20,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: th.tileBg,
                    color: th.tileFg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                    fontWeight: 700,
                  }}
                >
                  {th.glyph}
                </div>
                <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.2 }}>
                    {r(record.hero.headline)}
                  </div>
                  <div style={{ color: "var(--dd-text-subtle)" }}>{r(record.hero.claimShort)}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", marginLeft: "auto" }}>
                  <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{r(record.hero.amountLabel)}</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: th.amount, fontVariantNumeric: "tabular-nums" }}>
                    {record.header.amount}
                  </span>
                </div>
              </div>
              <div
                style={{
                  marginLeft: "clamp(0px, calc((100% - 420px) * 999), 56px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <p
                  data-testid="dispute-record-account"
                  style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: "#344054", textWrap: "pretty" } as CSSProperties}
                >
                  {account}
                </p>
                <div style={{ display: record.showRoles ? "flex" : "none", gap: 8, flexWrap: "wrap" }}>
                  {ROLE_ORDER.map((role) => (
                    <span
                      key={role}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: ROLE_STYLE[role].bg,
                        color: ROLE_STYLE[role].fg,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: ROLE_STYLE[role].dot }} />
                      {t(`disputes.record.role.${role}`)} · {record.counts[role]}
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: 12, color: "var(--dd-text-subtle)" }}>{t("disputes.record.ui.forYouOnly")}</span>
              </div>
            </div>

            <PackBanners workspace={workspace} t={t} />
            {record.canDecide ? <DecisionRow workspace={workspace} record={record} t={t} /> : null}

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
  return (
    <>
      {help ? (
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

      <BankClaimCard workspace={workspace} />
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
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "#1D4ED8",
        color: "#FFFFFF",
        borderRadius: 8,
        padding: "6px 12px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        border: 0,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "inherit",
      }}
    >
      {label}
    </button>
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

/** Evidence tab controls: parcel outcome, return confirmation, Gorgias review, upload / waive. */
function EvidenceActions({ workspace }: { workspace: Workspace }) {
  const { data, clientState, actions } = workspace;
  const sections = useEvidenceSections(workspace);
  const isWindowClosed = data?.dispute?.submissionState === "submitted_confirmed";
  return (
    <>
      <ParcelOutcomeCard workspace={workspace} />
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

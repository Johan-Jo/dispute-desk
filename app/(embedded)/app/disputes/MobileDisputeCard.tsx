"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { Icon } from "@shopify/polaris";
import { ChevronRightIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import { STRENGTH_CHIP } from "@/lib/disputes/presentation/uiTokens";
import { attentionSectionForAttention } from "@/lib/disputes/attentionDeepLink";
import {
  figmaCaseStrength,
  figmaDueDate,
  rowPrimaryState,
  figmaOutcome,
  rowChromeV2,
  figmaReviewChip,
  figmaStatus,
  formatCurrency,
  orderLabel,
  translateReason,
  type Dispute,
  type FigmaCaseStrength,
  type FigmaDueStatus,
  type FigmaOutcome,
  type TabId,
} from "./disputeListHelpers";
import { phaseLabel } from "@/lib/disputes/phaseUtils";
import type { DisputePhase } from "@/lib/rules/disputeReasons";

function phasePillColors(phase: DisputePhase | null): { bg: string; color: string } {
  if (phase === "inquiry") return { bg: "#E0F2FE", color: "#075985" };
  return { bg: "#FEF3C7", color: "#92400E" };
}

function shortDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  dispute: Dispute;
  activeTab: TabId;
  searchParams: ReadonlyURLSearchParams | null;
  dateLocale: string;
  numberLocale: string;
  t: Translate;
}

const PILL_STYLE: CSSProperties = {
  padding: "2px 10px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
};

function caseStrengthPillColors(s: FigmaCaseStrength, t: Translate): {
  bg: string;
  color: string;
  label: string;
} {
  // Shared STRENGTH_CHIP colors — weak is grey, not red (matches detail).
  if (s === "strong") return { ...STRENGTH_CHIP.strong, color: STRENGTH_CHIP.strong.fg, label: t("disputes.strengthStrong") };
  if (s === "moderate") return { ...STRENGTH_CHIP.moderate, color: STRENGTH_CHIP.moderate.fg, label: t("disputes.strengthModerate") };
  return { ...STRENGTH_CHIP.weak, color: STRENGTH_CHIP.weak.fg, label: t("disputes.strengthWeak") };
}

function outcomePillColors(o: FigmaOutcome, t: Translate): {
  bg: string;
  color: string;
  label: string;
} {
  if (o === "won") return { bg: "#D1FAE5", color: "#065F46", label: t("disputes.outcomeWon") };
  if (o === "lost") return { bg: "#FEE2E2", color: "#991B1B", label: t("disputes.outcomeLost") };
  if (o === "closed") return { bg: "#F1F2F3", color: "#4B5563", label: t("disputes.outcomeClosed") };
  return { bg: "#E1E3E5", color: "#6D7175", label: t("disputes.outcomePending") };
}

function dueDateColor(status: FigmaDueStatus): string {
  if (status === "past") return "#EF4444";
  if (status === "today") return "#F59E0B";
  return "#202223";
}

export function MobileDisputeCard({
  dispute: d,
  searchParams,
  dateLocale,
  numberLocale,
  t,
}: Props) {
  const rowSection = attentionSectionForAttention(d.presentation?.attention);
  const detailHref = withShopParams(
    rowSection ? `/app/disputes/${d.id}?section=${rowSection}` : `/app/disputes/${d.id}`,
    searchParams ?? new URLSearchParams(),
  );
  const status = figmaStatus(d);
  const strength = figmaCaseStrength(d);
  const reviewChip = figmaReviewChip(d, t);
  const outcome = figmaOutcome(d);
  const due = figmaDueDate(d, t, dateLocale);
  const next = rowPrimaryState(d, t);
  const chrome = rowChromeV2(d);
  // approved / conceded rows are routed out of the actionable statuses by
  // figmaStatus, so this stays correct without an extra guard.
  // Prominence follows MERCHANT ATTENTION (genuine tasks only), never
  // "every active dispute" (plan §5). Legacy status fallback for rows
  // without a presentation.
  // A recorded review decision calms the card (matches the detail page +
  // rowChromeV2) — an in_review/approved/conceded dispute is not an open
  // task even if the underlying attention gate is still technically open.
  const isActionable = d.review_state
    ? false
    : d.presentation
      ? d.presentation.needsMerchantAction
      : status === "action-needed" || status === "needs-review";

  const cardStyle: CSSProperties = {
    background: chrome.bgColor ?? "#ffffff",
    border: "1px solid #C9CCCF",
    borderRadius: 8,
    borderLeft: chrome.stripeColor
      ? `4px solid ${chrome.stripeColor}`
      : "1px solid #C9CCCF",
    padding: 16,
    opacity: chrome.opacity,
    display: "block",
    color: "inherit",
    textDecoration: "none",
  };

  const outcomePill = outcomePillColors(outcome, t);

  return (
    <Link href={detailHref} style={cardStyle}>
      {/* Top section: strength pill + subtitle, then order/customer/reason, chevron */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {strength && (
            <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
              <span style={{ ...PILL_STYLE, ...caseStrengthPillColors(strength, t) }}>
                {caseStrengthPillColors(strength, t).label}
              </span>
              {reviewChip && (
                <span
                  style={{
                    ...PILL_STYLE,
                    background: reviewChip.bg,
                    color: reviewChip.color,
                    display: "inline-flex",
                  }}
                >
                  {reviewChip.label}
                </span>
              )}
            </div>
          )}
          {!strength && reviewChip && (
            <div style={{ marginBottom: 8 }}>
              <span
                style={{
                  ...PILL_STYLE,
                  background: reviewChip.bg,
                  color: reviewChip.color,
                  display: "inline-flex",
                }}
              >
                {reviewChip.label}
              </span>
            </div>
          )}
          <p
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#202223",
              margin: 0,
              marginBottom: 4,
              lineHeight: 1.4,
            }}
          >
            {orderLabel(d)} · {d.customer_display_name ?? "—"}
          </p>
          <p
            style={{
              fontSize: 14,
              color: "#6D7175",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {translateReason(d.reason, t)}
          </p>
          <div style={{ marginTop: 6 }}>
            <span style={{ ...PILL_STYLE, ...phasePillColors(d.phase as DisputePhase | null) }}>
              {phaseLabel(d.phase as DisputePhase | null, t)}
            </span>
          </div>
        </div>
        <span
          style={{
            width: 20,
            height: 20,
            color: "#6D7175",
            flexShrink: 0,
            display: "inline-flex",
            marginTop: 2,
          }}
        >
          <Icon source={ChevronRightIcon} />
        </span>
      </div>

      {/* Amount + Date + Due date */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          paddingTop: 12,
          borderTop: "1px solid #E1E3E5",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 2 }}>
            {t("disputes.colAmount")}
          </div>
          <div style={{ fontSize: 14, color: "#202223" }}>
            {formatCurrency(d.amount, d.currency_code, numberLocale)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 2 }}>
            {t("table.date")}
          </div>
          <div style={{ fontSize: 14, color: "#202223" }}>
            {shortDate(d.initiated_at, dateLocale)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 2 }}>
            {t("disputes.colDueDate")}
          </div>
          <div
            style={{
              fontSize: 14,
              color: dueDateColor(due.status),
              fontWeight: due.status === "past" || due.status === "today" ? 600 : 400,
            }}
          >
            {due.label}
          </div>
        </div>
      </div>

      {/* Outcome */}
      <div
        style={{
          paddingTop: 12,
          borderTop: "1px solid #E1E3E5",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            ...PILL_STYLE,
            background: outcomePill.bg,
            color: outcomePill.color,
          }}
        >
          {outcomePill.label}
        </span>
      </div>

      {/* Status & next step — primary treatment only when a genuine
          merchant task exists; calm secondary treatment for routine
          DisputeDesk work. Two lines: lifecycle label + responsibility
          copy (plan §5). */}
      <div
        style={{
          paddingTop: 12,
          borderTop: "1px solid #E1E3E5",
        }}
      >
        <div
          style={{
            width: "100%",
            padding: "8px 16px",
            background: isActionable ? "#005BD3" : "#F6F8FB",
            border: isActionable ? "1px solid #005BD3" : "1px solid #C9CCCF",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            color: isActionable ? "#ffffff" : "#202223",
            textAlign: "center",
          }}
        >
          {next.label}
        </div>
        {next.sub ? (
          <div
            style={{
              fontSize: 12,
              color: "#6D7175",
              marginTop: 6,
              lineHeight: 1.4,
              textAlign: "center",
            }}
          >
            {next.sub}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

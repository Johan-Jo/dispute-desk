"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { Icon } from "@shopify/polaris";
import { ChevronRightIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import {
  figmaCaseStrength,
  figmaDueDate,
  figmaNextAction,
  figmaOutcome,
  figmaRowChrome,
  figmaStatus,
  figmaStrengthDetail,
  formatCurrency,
  orderLabel,
  translateReason,
  type Dispute,
  type FigmaCaseStrength,
  type FigmaDueStatus,
  type FigmaOutcome,
  type TabId,
} from "./disputeListHelpers";

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

function caseStrengthPillColors(s: FigmaCaseStrength): {
  bg: string;
  color: string;
  label: string;
} {
  if (s === "strong") return { bg: "#D1FAE5", color: "#065F46", label: "Strong" };
  if (s === "moderate") return { bg: "#FEF3C7", color: "#92400E", label: "Moderate" };
  return { bg: "#FEE2E2", color: "#991B1B", label: "Weak" };
}

/** Subtitle color tied to strength (red/yellow/green pattern, same
 *  as the detail page). */
function caseStrengthSubtitleColor(s: FigmaCaseStrength): string {
  if (s === "strong") return "#065F46";
  if (s === "moderate") return "#92400E";
  return "#991B1B";
}

function outcomePillColors(o: FigmaOutcome, t: Translate): {
  bg: string;
  color: string;
  label: string;
} {
  if (o === "won") return { bg: "#D1FAE5", color: "#065F46", label: t("disputes.outcomeWon") };
  if (o === "lost") return { bg: "#FEE2E2", color: "#991B1B", label: t("disputes.outcomeLost") };
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
  const detailHref = withShopParams(
    `/app/disputes/${d.id}`,
    searchParams ?? new URLSearchParams(),
  );
  const status = figmaStatus(d);
  const strength = figmaCaseStrength(d);
  const detail = figmaStrengthDetail(d, t);
  const outcome = figmaOutcome(d);
  const due = figmaDueDate(d, t, dateLocale);
  const next = figmaNextAction(d, t);
  const chrome = figmaRowChrome(d);
  const isActionable = status === "action-needed" || status === "needs-review";

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
            <div style={{ marginBottom: 8 }}>
              <span style={{ ...PILL_STYLE, ...caseStrengthPillColors(strength) }}>
                {caseStrengthPillColors(strength).label}
              </span>
              {detail && (
                <div
                  style={{
                    fontSize: 12,
                    color: caseStrengthSubtitleColor(strength),
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}
                >
                  {detail}
                </div>
              )}
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

      {/* Amount + Due date */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
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

      {/* Next action — full-width primary button on actionable rows,
          subdued secondary text otherwise. Same destination as the
          card link; this is purely a visual-prominence signal. */}
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
          {next}
        </div>
      </div>
    </Link>
  );
}

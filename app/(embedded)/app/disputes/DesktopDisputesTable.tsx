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
} from "./disputeListHelpers";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  disputes: Dispute[];
  // activeTab is no longer used to vary columns — the new design uses
  // a single status dropdown on the page level. Kept in props so the
  // existing call sites compile until page.tsx is restructured.
  activeTab?: unknown;
  searchParams: ReadonlyURLSearchParams | null;
  dateLocale: string;
  numberLocale: string;
  t: Translate;
}

/* ── Shared inline style atoms ── */

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
  return "#6D7175";
}

function dueDateWeight(status: FigmaDueStatus): number {
  return status === "past" || status === "today" ? 600 : 400;
}

const COL_HEADER_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export function DesktopDisputesTable({
  disputes,
  searchParams,
  dateLocale,
  numberLocale,
  t,
}: Props) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #C9CCCF",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        style={{
          background: "#F6F8FB",
          borderBottom: "1px solid #E1E3E5",
          padding: "12px 16px",
          display: "grid",
          gridTemplateColumns: "3fr 2fr 2fr 1fr 2fr 1fr",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div style={COL_HEADER_STYLE}>{t("disputes.colOrderCustomer")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colCaseStrength")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colNextAction")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colAmount")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colDueDate")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colOutcome")}</div>
      </div>

      {/* Rows */}
      <div>
        {disputes.map((d) => {
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

          const rowStyle: CSSProperties = {
            display: "grid",
            gridTemplateColumns: "3fr 2fr 2fr 1fr 2fr 1fr",
            gap: 16,
            alignItems: "center",
            padding: "16px",
            paddingLeft: chrome.stripeColor ? 12 : 16,
            borderBottom: "1px solid #E1E3E5",
            borderLeft: chrome.stripeColor
              ? `4px solid ${chrome.stripeColor}`
              : "4px solid transparent",
            background: chrome.bgColor ?? "#ffffff",
            opacity: chrome.opacity,
            color: "#202223",
            textDecoration: "none",
            cursor: "pointer",
          };

          const outcomePill = outcomePillColors(outcome, t);

          return (
            <Link
              key={d.id}
              href={detailHref}
              style={rowStyle}
              data-status={status}
            >
              {/* Order & Customer */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#202223",
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {orderLabel(d)}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#6D7175",
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.customer_display_name ?? "—"}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#6D7175",
                    marginTop: 2,
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {translateReason(d.reason, t)}
                </div>
              </div>

              {/* Case strength + subtitle */}
              <div style={{ minWidth: 0 }}>
                {strength ? (
                  <>
                    <span
                      style={{
                        ...PILL_STYLE,
                        ...caseStrengthPillColors(strength),
                      }}
                    >
                      {caseStrengthPillColors(strength).label}
                    </span>
                    {detail && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6D7175",
                          marginTop: 4,
                          lineHeight: 1.4,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {detail}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 14, color: "#6D7175" }}>—</span>
                )}
              </div>

              {/* Next action */}
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "#005BD3",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {next}
              </div>

              {/* Amount */}
              <div style={{ fontSize: 14, color: "#202223" }}>
                {formatCurrency(d.amount, d.currency_code, numberLocale)}
              </div>

              {/* Due date */}
              <div
                style={{
                  fontSize: 14,
                  color: dueDateColor(due.status),
                  fontWeight: dueDateWeight(due.status),
                }}
              >
                {due.label}
              </div>

              {/* Outcome + chevron */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  minWidth: 0,
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
                <span
                  style={{
                    width: 20,
                    height: 20,
                    color: "#6D7175",
                    flexShrink: 0,
                    display: "inline-flex",
                  }}
                >
                  <Icon source={ChevronRightIcon} />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

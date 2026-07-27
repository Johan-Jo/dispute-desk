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
  rowPrimaryState,
  figmaOutcome,
  figmaReviewChip,
  rowChromeV2,
  figmaStatus,
  formatCurrency,
  orderLabel,
  translateReason,
  type Dispute,
  type FigmaCaseStrength,
  type FigmaDueStatus,
  type FigmaOutcome,
} from "./disputeListHelpers";
import { phaseLabel } from "@/lib/disputes/phaseUtils";
import type { DisputePhase } from "@/lib/rules/disputeReasons";

/** 8-column grid shared by the header + every row. */
const GRID_COLUMNS = "2.6fr 1fr 1.8fr 1.8fr 1fr 1.4fr 1.6fr 1fr";

/** Short dispute date (from initiated_at). "—" when absent. */
function formatDisputeDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

/** Compact inquiry/chargeback pill. */
function phasePillColors(phase: DisputePhase | null): { bg: string; color: string } {
  if (phase === "inquiry") return { bg: "#E0F2FE", color: "#075985" };
  return { bg: "#FEF3C7", color: "#92400E" }; // chargeback (default)
}

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

function caseStrengthPillColors(s: FigmaCaseStrength, t: Translate): {
  bg: string;
  color: string;
  label: string;
} {
  if (s === "strong") return { bg: "#D1FAE5", color: "#065F46", label: t("disputes.strengthStrong") };
  if (s === "moderate") return { bg: "#FEF3C7", color: "#92400E", label: t("disputes.strengthModerate") };
  return { bg: "#FEE2E2", color: "#991B1B", label: t("disputes.strengthWeak") };
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
          gridTemplateColumns: GRID_COLUMNS,
          gap: 16,
          alignItems: "center",
        }}
      >
        <div style={COL_HEADER_STYLE}>{t("disputes.colOrderCustomer")}</div>
        <div style={COL_HEADER_STYLE}>{t("table.type")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colCaseStrength")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colNextAction")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colAmount")}</div>
        <div style={COL_HEADER_STYLE}>{t("table.date")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colDueDate")}</div>
        <div style={COL_HEADER_STYLE}>{t("disputes.colOutcome")}</div>
      </div>

      {/* Rows */}
      <div>
        {disputes.map((d, rowIdx) => {
          const detailHref = withShopParams(
            `/app/disputes/${d.id}`,
            searchParams ?? new URLSearchParams(),
          );
          const status = figmaStatus(d);
          const strength = figmaCaseStrength(d);
          const reviewChip = figmaReviewChip(d, t);
          const outcome = figmaOutcome(d);
          const due = figmaDueDate(d, t, dateLocale);
          const next = rowPrimaryState(d, t);
          const chrome = rowChromeV2(d);

          const rowStyle: CSSProperties = {
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
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
              {...(rowIdx === 0 ? { "data-help-guide": "dispute-row" } : {})}
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

              {/* Type (inquiry / chargeback) */}
              <div style={{ minWidth: 0 }}>
                <span
                  style={{
                    ...PILL_STYLE,
                    ...phasePillColors(d.phase as DisputePhase | null),
                  }}
                >
                  {phaseLabel(d.phase as DisputePhase | null, t)}
                </span>
              </div>

              {/* Case strength + review-decision chip — stacked: the
                  decision chip (e.g. "Scheduled") sits BELOW the strength
                  pill, not to its right. */}
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                {strength ? (
                  <span
                    style={{
                      ...PILL_STYLE,
                      ...caseStrengthPillColors(strength, t),
                    }}
                  >
                    {caseStrengthPillColors(strength, t).label}
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: "#6D7175" }}>—</span>
                )}
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

              {/* Status & next step — two lines: primary operational
                  lifecycle label + secondary responsibility copy (never
                  an imperative). Plan §5. */}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#202223",
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {next.label}
                </div>
                {next.sub ? (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "#6D7175",
                      marginTop: 2,
                      lineHeight: 1.4,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {next.sub}
                  </div>
                ) : null}
              </div>

              {/* Amount */}
              <div style={{ fontSize: 14, color: "#202223" }}>
                {formatCurrency(d.amount, d.currency_code, numberLocale)}
              </div>

              {/* Date (dispute initiated) */}
              <div style={{ fontSize: 14, color: "#6D7175" }}>
                {formatDisputeDate(d.initiated_at, dateLocale)}
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

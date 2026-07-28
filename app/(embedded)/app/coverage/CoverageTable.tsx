"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { Icon } from "@shopify/polaris";
import {
  ShieldPersonIcon,
  AlertTriangleIcon,
  DeliveryIcon,
  OrderIcon,
  ReceiptRefundIcon,
  DuplicateIcon,
  ClipboardCheckFilledIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import {
  FAMILY_ICON_COLOR,
  familyLabelKey,
  type ChargebackStatus,
  type CoverageRow,
  type CurrentMode,
  type InquiryStatus,
} from "./coverageHelpers";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  rows: CoverageRow[];
  searchParams: ReadonlyURLSearchParams | null;
  tc: Translate;
}

const FAMILY_ICONS: Record<string, typeof ShieldPersonIcon> = {
  fraud: ShieldPersonIcon,
  pnr: DeliveryIcon,
  not_as_described: AlertTriangleIcon,
  subscription: OrderIcon,
  refund: ReceiptRefundIcon,
  duplicate: DuplicateIcon,
  general: ClipboardCheckFilledIcon,
};

const PILL: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};

function chargebackPill(status: ChargebackStatus, tc: Translate) {
  const map: Record<ChargebackStatus, { bg: string; color: string; key: string }> = {
    "configured": { bg: "#D1FAE5", color: "#065F46", key: "handlingConfigured" },
    "missing-playbook": { bg: "#FEF3C7", color: "#92400E", key: "handlingMissingPlaybook" },
    "needs-rule": { bg: "#FEE2E2", color: "#991B1B", key: "handlingNeedsRule" },
  };
  const c = map[status];
  return (
    <span style={{ ...PILL, background: c.bg, color: c.color }}>{tc(c.key)}</span>
  );
}

function inquiryPill(status: InquiryStatus, tc: Translate) {
  const c = status === "enabled"
    ? { bg: "#D1FAE5", color: "#065F46", key: "inquiryEnabled" }
    : { bg: "#E1E3E5", color: "#6D7175", key: "inquiryDisabled" };
  return (
    <span style={{ ...PILL, background: c.bg, color: c.color }}>{tc(c.key)}</span>
  );
}

function modePill(mode: CurrentMode, tc: Translate) {
  const map: Record<CurrentMode, { bg: string; color: string; key: string }> = {
    "auto-submit": { bg: "#D1FAE5", color: "#065F46", key: "modeAutoSubmit" },
    "review": { bg: "#FEF3C7", color: "#92400E", key: "modeReviewLabel" },
  };
  const c = map[mode];
  return (
    <span style={{ ...PILL, background: c.bg, color: c.color }}>{tc(c.key)}</span>
  );
}

export function FamilyIconCell({ familyId }: { familyId: string }) {
  const Source = FAMILY_ICONS[familyId] ?? ClipboardCheckFilledIcon;
  const color = FAMILY_ICON_COLOR[familyId] ?? "#6D7175";
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: "#F6F8FB",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
      }}
    >
      <Icon source={Source} />
    </div>
  );
}

export { chargebackPill, inquiryPill, modePill };

export function CoverageTable({ rows, searchParams, tc }: Props) {
  const headerCell: CSSProperties = {
    textAlign: "left",
    padding: "12px 20px",
    fontSize: 12,
    fontWeight: 500,
    color: "#6D7175",
    background: "#F6F8FB",
    borderBottom: "1px solid #E1E3E5",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={headerCell}>{tc("colDisputeType")}</th>
            <th style={headerCell}>{tc("colChargebackHandling")}</th>
            <th style={headerCell}>{tc("colInquiryHandling")}</th>
            <th style={headerCell}>{tc("colCurrentMode")}</th>
            <th style={headerCell}>{tc("colAction")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isLast = idx === rows.length - 1;
            const cell: CSSProperties = {
              padding: "16px 20px",
              borderBottom: isLast ? "none" : "1px solid #E1E3E5",
              verticalAlign: "middle",
            };
            return (
              <tr key={row.familyId}>
                <td style={cell}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <FamilyIconCell familyId={row.familyId} />
                    <span style={{ fontSize: 14, fontWeight: 500, color: "#202223" }}>
                      {tc(familyLabelKey(row.labelKey))}
                    </span>
                  </div>
                </td>
                <td style={cell}>{chargebackPill(row.chargeback, tc)}</td>
                <td style={cell}>{inquiryPill(row.inquiry, tc)}</td>
                <td style={cell}>{modePill(row.mode, tc)}</td>
                <td style={cell}>
                  <a
                    href={withShopParams(
                      // Handling is store-wide now — there is no per-family
                      // row to deep-link to (the 7-row grid is gone).
                      `/app/rules`,
                      searchParams ?? new URLSearchParams(),
                    )}
                    style={{
                      display: "inline-block",
                      padding: "6px 12px",
                      border: "1px solid #C9CCCF",
                      background: "#ffffff",
                      color: "#202223",
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 4,
                      textDecoration: "none",
                    }}
                  >
                    {tc("editHandling")}
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

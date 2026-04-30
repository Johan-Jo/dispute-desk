"use client";

import type { ReadonlyURLSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import {
  chargebackPill,
  inquiryPill,
  modePill,
  FamilyIconCell,
} from "./CoverageTable";
import { familyLabelKey, type CoverageRow } from "./coverageHelpers";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  rows: CoverageRow[];
  searchParams: ReadonlyURLSearchParams | null;
  tc: Translate;
}

export function MobileCoverageList({ rows, searchParams, tc }: Props) {
  return (
    <div>
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        return (
          <div
            key={row.familyId}
            style={{
              padding: 16,
              borderBottom: isLast ? "none" : "1px solid #E1E3E5",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <FamilyIconCell familyId={row.familyId} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
                {tc(familyLabelKey(row.labelKey))}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <Row label={tc("colChargebackHandling")} value={chargebackPill(row.chargeback, tc)} />
              <Row label={tc("colInquiryHandling")} value={inquiryPill(row.inquiry, tc)} />
              <Row label={tc("colCurrentMode")} value={modePill(row.mode, tc)} />
            </div>

            <a
              href={withShopParams(
                `/app/rules?family=${row.familyId}`,
                searchParams ?? new URLSearchParams(),
              )}
              style={{
                display: "block",
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #C9CCCF",
                background: "#ffffff",
                color: "#202223",
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 4,
                textAlign: "center",
                textDecoration: "none",
                boxSizing: "border-box",
              }}
            >
              {tc("editHandling")}
            </a>
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 12, color: "#6D7175" }}>{label}</span>
      <div>{value}</div>
    </div>
  );
}

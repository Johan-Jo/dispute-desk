"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { Icon } from "@shopify/polaris";
import { ChevronRightIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import styles from "./disputes-list.module.css";
import {
  dueDateTone,
  evidenceStatusBadge,
  formatCurrency,
  formatDueDate,
  orderLabel,
  outcomeBadge,
  statusPillFigma,
  translateReason,
  type Dispute,
  type FlatPill,
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

const PILL_STYLE = {
  padding: "2px 10px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap" as const,
  display: "inline-flex",
  alignItems: "center",
};

function Pill({ pill }: { pill: FlatPill }) {
  return (
    <span style={{ ...PILL_STYLE, background: pill.bg, color: pill.color }}>
      {pill.label}
    </span>
  );
}

export function MobileDisputeCard({
  dispute: d,
  activeTab: _activeTab,
  searchParams,
  dateLocale,
  numberLocale,
  t,
}: Props) {
  const detailHref = withShopParams(
    `/app/disputes/${d.id}`,
    searchParams ?? new URLSearchParams(),
  );
  const statusPill = statusPillFigma(d, t);
  const evidencePill = evidenceStatusBadge(d, t);
  const outcomePill = outcomeBadge(d, t);
  const dueTone = dueDateTone(d.due_at);

  return (
    <Link href={detailHref} className={styles.mobileCardLink}>
      {/* Top section — status pill + order id + customer + reason + chevron */}
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <Pill pill={statusPill} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#202223",
              }}
            >
              {orderLabel(d)}
            </span>
          </div>
          <p
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#202223",
              margin: 0,
              marginBottom: 4,
            }}
          >
            {d.customer_display_name ?? "—"}
          </p>
          <p
            style={{
              fontSize: 14,
              color: "#6D7175",
              margin: 0,
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

      {/* Divider + amount/due-date row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 12,
          borderTop: "1px solid #E1E3E5",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12, color: "#6D7175" }}>{t("table.amount")}</span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#202223",
            }}
          >
            {formatCurrency(d.amount, d.currency_code, numberLocale)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            alignItems: "flex-end",
          }}
        >
          <span style={{ fontSize: 12, color: "#6D7175" }}>
            {t("disputes.columnDueDate")}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: dueTone === "critical" ? 600 : 500,
              color: dueTone === "critical" ? "#DC2626" : "#202223",
            }}
          >
            {formatDueDate(d.due_at, dateLocale)}
          </span>
        </div>
      </div>

      {/* Divider + evidence + outcome pills */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingTop: 12,
          borderTop: "1px solid #E1E3E5",
          flexWrap: "wrap",
        }}
      >
        {evidencePill && <Pill pill={evidencePill} />}
        <Pill pill={outcomePill} />
      </div>
    </Link>
  );
}

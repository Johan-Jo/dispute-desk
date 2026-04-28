"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
import styles from "./disputes-list.module.css";
import {
  actionCtaLabel,
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
  disputes: Dispute[];
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

export function DesktopDisputesTable({
  disputes,
  // activeTab is no longer used to vary columns — Outcome renders on
  // every row per Figma. Kept in props for prior API compat in case
  // future callers need it.
  activeTab: _activeTab,
  searchParams,
  dateLocale,
  numberLocale,
  t,
}: Props) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.listTable}>
        <thead>
          <tr>
            <th>{t("table.status")}</th>
            <th>{t("table.order")}</th>
            <th>{t("disputes.columnCustomerName")}</th>
            <th>{t("table.reason")}</th>
            <th>{t("table.amount")}</th>
            <th>{t("disputes.columnEvidenceStatus")}</th>
            <th>{t("disputes.columnOutcome")}</th>
            <th>{t("disputes.columnDueDate")}</th>
            <th>{t("disputes.columnAction")}</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => {
            const detailHref = withShopParams(
              `/app/disputes/${d.id}`,
              searchParams ?? new URLSearchParams(),
            );
            const statusPill = statusPillFigma(d, t);
            const evidencePill = evidenceStatusBadge(d, t);
            const outcomePill = outcomeBadge(d, t);
            const dueTone = dueDateTone(d.due_at);
            const cta = actionCtaLabel(d, t);
            return (
              <tr key={d.id}>
                <td>
                  <Pill pill={statusPill} />
                </td>
                <td>
                  <span className={styles.cellOrder}>{orderLabel(d)}</span>
                </td>
                <td>
                  <span className={styles.cellCustomer}>
                    {d.customer_display_name ?? "—"}
                  </span>
                </td>
                <td>
                  <span className={styles.cellMuted}>
                    {translateReason(d.reason, t)}
                  </span>
                </td>
                <td>
                  <span className={styles.cellAmount}>
                    {formatCurrency(d.amount, d.currency_code, numberLocale)}
                  </span>
                </td>
                <td>
                  {evidencePill ? (
                    <Pill pill={evidencePill} />
                  ) : (
                    <span className={styles.cellMuted}>—</span>
                  )}
                </td>
                <td>
                  <Pill pill={outcomePill} />
                </td>
                <td>
                  <span
                    className={
                      dueTone === "critical"
                        ? styles.cellDueCritical
                        : styles.cellMuted
                    }
                  >
                    {formatDueDate(d.due_at, dateLocale)}
                  </span>
                </td>
                <td>
                  <Link href={detailHref} className={styles.cellAction}>
                    {cta}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

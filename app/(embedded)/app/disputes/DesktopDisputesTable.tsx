"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { Badge, Text } from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import { recentDisputesViewDetailsLinkStyle } from "@/lib/embedded/recentDisputesTableStyles";
import { phaseBadgeTone, phaseLabel as phaseLabelFn } from "@/lib/disputes/phaseUtils";
import styles from "./disputes-list.module.css";
import {
  NORMALIZED_STATUS_TONE,
  OUTCOME_TONE,
  formatCurrency,
  formatDueDate,
  getUrgency,
  orderLabel,
  statusBadgeLabel,
  statusBadgeTone,
  translateReason,
  type Dispute,
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

export function DesktopDisputesTable({
  disputes,
  activeTab,
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
            <th>{t("disputes.phaseLabel")}</th>
            <th>{t("table.order")}</th>
            <th>{t("table.customer")}</th>
            <th>{t("table.reason")}</th>
            <th>{t("table.amount")}</th>
            <th>{t("table.status")}</th>
            {activeTab === "closed" ? (
              <>
                <th>{t("disputes.columnOutcome")}</th>
                <th>{t("disputes.columnClosedAt")}</th>
              </>
            ) : (
              <th>{t("table.urgency")}</th>
            )}
            <th>{t("table.date")}</th>
            <th>{t("table.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => {
            const label = orderLabel(d);
            const detailHref = withShopParams(
              `/app/disputes/${d.id}`,
              searchParams ?? new URLSearchParams(),
            );
            const urgency = getUrgency(d, t);
            const ns = d.normalized_status;
            return (
              <tr key={d.id}>
                <td>
                  <Badge tone={phaseBadgeTone(d.phase as "inquiry" | "chargeback" | null)}>
                    {phaseLabelFn(d.phase as "inquiry" | "chargeback" | null, t)}
                  </Badge>
                </td>
                <td>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {label}
                  </Text>
                </td>
                <td>
                  <Text as="span" variant="bodySm">
                    {d.customer_display_name ?? "—"}
                  </Text>
                </td>
                <td>
                  <span className={styles.cellMuted}>{translateReason(d.reason, t)}</span>
                </td>
                <td>
                  <span className={styles.cellAmount}>
                    {formatCurrency(d.amount, d.currency_code, numberLocale)}
                  </span>
                </td>
                <td>
                  <Badge tone={ns ? NORMALIZED_STATUS_TONE[ns] : statusBadgeTone(d.status)}>
                    {ns
                      ? t(`disputeTimeline.normalizedStatuses.${ns}`)
                      : statusBadgeLabel(d.status, t)}
                  </Badge>
                </td>
                {activeTab === "closed" ? (
                  <>
                    <td>
                      {d.final_outcome ? (
                        <Badge tone={OUTCOME_TONE[d.final_outcome]}>
                          {t(`disputeTimeline.outcomes.${d.final_outcome}`)}
                        </Badge>
                      ) : (
                        <span className={styles.cellMuted}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={styles.cellMuted}>
                        {formatDueDate(d.closed_at ?? null, dateLocale)}
                      </span>
                    </td>
                  </>
                ) : (
                  <td>
                    <Badge tone={urgency.tone}>{urgency.label}</Badge>
                  </td>
                )}
                <td>
                  <span className={styles.cellMuted}>
                    {d.initiated_at
                      ? new Date(d.initiated_at).toLocaleDateString(dateLocale, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </span>
                </td>
                <td>
                  <Link href={detailHref} style={recentDisputesViewDetailsLinkStyle}>
                    {t("table.viewDetails")}
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

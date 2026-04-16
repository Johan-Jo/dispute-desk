"use client";

import { useTranslations } from "next-intl";
import { Card, Text, Badge } from "@shopify/polaris";
import type { Dispute, DeadlineInfo } from "./utils";
import { formatCurrency, formatDate, statusTone, statusLabel } from "./utils";
import styles from "../dispute-detail.module.css";

interface KeyDisputeFactsProps {
  dispute: Dispute;
  deadline: DeadlineInfo;
}

function FactItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={styles.summaryItem}>
      <p className={styles.summaryItemLabel}>{label}</p>
      <div className={styles.summaryItemValue}>{value}</div>
    </div>
  );
}

export default function KeyDisputeFacts({
  dispute,
  deadline,
}: KeyDisputeFactsProps) {
  const t = useTranslations();

  return (
    <Card>
      <Text as="h2" variant="headingSm">
        {t("disputes.facts.title")}
      </Text>
      <div className={styles.summaryGrid}>
        <FactItem
          label={t("disputes.facts.amount")}
          value={formatCurrency(dispute.amount, dispute.currency_code)}
        />
        <FactItem
          label={t("disputes.facts.deadline")}
          value={
            deadline.urgent ? (
              <span style={{ color: "#EF4444", fontWeight: 600 }}>
                {formatDate(dispute.due_at)} ({deadline.text})
              </span>
            ) : (
              formatDate(dispute.due_at)
            )
          }
        />
        <FactItem
          label={t("disputes.facts.reason")}
          value={dispute.reason?.replace(/_/g, " ") ?? "\u2014"}
        />
        <FactItem
          label={t("disputes.facts.status")}
          value={
            <Badge tone={statusTone(dispute.status)}>
              {statusLabel(dispute.status, t)}
            </Badge>
          }
        />
        <FactItem
          label={t("disputes.facts.source")}
          value="Shopify Payments"
        />
        <FactItem
          label={t("disputes.facts.created")}
          value={formatDate(dispute.initiated_at)}
        />
      </div>
    </Card>
  );
}

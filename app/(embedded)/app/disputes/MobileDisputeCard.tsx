"use client";

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { Badge, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import { phaseLabel as phaseLabelFn } from "@/lib/disputes/phaseUtils";
import styles from "./disputes-list.module.css";
import {
  NORMALIZED_STATUS_TONE,
  OUTCOME_TONE,
  formatCurrency,
  formatDueTiming,
  formatListDisputeId,
  getUrgency,
  orderLabel,
  statusBadgeLabel,
  statusBadgeTone,
  type Dispute,
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

export function MobileDisputeCard({
  dispute: d,
  activeTab,
  searchParams,
  dateLocale,
  numberLocale,
  t,
}: Props) {
  const detailHref = withShopParams(
    `/app/disputes/${d.id}`,
    searchParams ?? new URLSearchParams(),
  );
  const urgency = getUrgency(d, t);
  const dueTiming = formatDueTiming(d, activeTab, t, dateLocale);
  const ns = d.normalized_status;
  const statusTone = ns ? NORMALIZED_STATUS_TONE[ns] : statusBadgeTone(d.status);
  const statusText = ns
    ? t(`disputeTimeline.normalizedStatuses.${ns}`)
    : statusBadgeLabel(d.status, t);

  return (
    <Link href={detailHref} className={styles.mobileCardLink}>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
          <Badge tone={urgency.tone}>{urgency.label}</Badge>
          <span className={styles.mobileAmount}>
            <Text as="span" variant="headingLg" fontWeight="semibold">
              {formatCurrency(d.amount, d.currency_code, numberLocale)}
            </Text>
          </span>
        </InlineStack>

        <Text as="p" variant="headingSm" fontWeight="semibold" tone={dueTiming.tone}>
          {dueTiming.label}
        </Text>

        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {formatListDisputeId(d.id)} · {orderLabel(d)}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {d.customer_display_name ?? "—"}
          </Text>
        </BlockStack>

        <InlineStack gap="100" wrap>
          <Badge size="small">
            {phaseLabelFn(d.phase as "inquiry" | "chargeback" | null, t)}
          </Badge>
          <Badge size="small" tone={statusTone}>
            {statusText}
          </Badge>
          {activeTab === "closed" && d.final_outcome && (
            <Badge size="small" tone={OUTCOME_TONE[d.final_outcome]}>
              {t(`disputeTimeline.outcomes.${d.final_outcome}`)}
            </Badge>
          )}
        </InlineStack>
      </BlockStack>
    </Link>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  IndexTable,
  InlineStack,
  Spinner,
  Text,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import type { Dispute } from "./disputes/disputeListHelpers";
import {
  formatCurrency,
  orderLabel,
  NORMALIZED_STATUS_TONE,
} from "./disputes/disputeListHelpers";
import { safeStatusLabel, useDateLocale } from "./dashboardHelpers";

function issueBadge(
  d: Dispute,
  t: ReturnType<typeof useTranslations>,
): { label: string; tone: "success" | "info" | "attention" | undefined } {
  switch (d.submission_state) {
    case "saved_to_shopify":
      return { label: t("dashboard.submittedToShopify"), tone: "info" };
    case "submitted_confirmed":
      return { label: t("dashboard.submittedToBank"), tone: "success" };
    case "submission_uncertain":
      return { label: t("status.pending"), tone: "attention" };
    case "manual_submission_reported":
      return { label: t("dashboard.submittedToBank"), tone: "success" };
    default:
      return { label: t("status.pending"), tone: undefined };
  }
}

function nextStepLabel(
  d: Dispute,
  t: ReturnType<typeof useTranslations>,
): string {
  if (
    d.submission_state === "submitted_confirmed" ||
    d.submission_state === "manual_submission_reported"
  ) {
    return t("dashboard.decisionPending");
  }
  if (d.due_at) {
    const diffMs = new Date(d.due_at).getTime() - Date.now();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 0) return t("dashboard.overdue");
    if (days === 1) return t("dashboard.dueIn1Day");
    return t("dashboard.dueInDays", { count: days });
  }
  return t("dashboard.decisionPending");
}

export function DashboardInProgressTable() {
  const t = useTranslations();
  const tDash = useTranslations("dashboard");
  const tTimeline = useTranslations("disputeTimeline");
  const dateLocale = useDateLocale();
  const searchParams = useSearchParams();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(
      "/api/disputes?normalized_status=in_progress,ready_to_submit,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank&sort=created_at&sort_dir=desc&per_page=10",
    )
      .then((r) => (r.ok ? r.json() : { disputes: [] }))
      .then((data: { disputes?: Dispute[] }) => {
        if (!cancelled) setDisputes(data.disputes ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner size="small" />
        </BlockStack>
      </Card>
    );
  }

  if (disputes.length === 0) return null;

  const sp = searchParams ?? new URLSearchParams();

  const headings: [{ title: string }, ...{ title: string }[]] = [
    { title: tDash("orderCol") },
    { title: tDash("amountCol") },
    { title: tDash("issueCol") },
    { title: tDash("submittedDateCol") },
    { title: tDash("nextStepCol") },
    { title: tDash("statusCol") },
  ];

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(dateLocale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {tDash("inProgress")} ({disputes.length})
          </Text>
          <Button
            variant="plain"
            url={withShopParams(
              "/app/disputes?normalized_status=in_progress,ready_to_submit,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank",
              sp,
            )}
          >
            {t("common.viewAll")}
          </Button>
        </InlineStack>
        <IndexTable
          resourceName={{ singular: "dispute", plural: "disputes" }}
          itemCount={disputes.length}
          headings={headings}
          selectable={false}
        >
          {disputes.map((d, idx) => {
            const issue = issueBadge(d, t);
            const statusTone =
              NORMALIZED_STATUS_TONE[d.normalized_status ?? ""] ?? undefined;
            return (
              <IndexTable.Row key={d.id} id={d.id} position={idx}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {orderLabel(d)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {formatCurrency(d.amount, d.currency_code, dateLocale)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={issue.tone}>{issue.label}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {formatDate(d.submitted_at)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone={
                    nextStepLabel(d, t).includes("1 day") || nextStepLabel(d, t) === t("dashboard.overdue")
                      ? "critical"
                      : "subdued"
                  }>
                    {nextStepLabel(d, t)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={statusTone}>
                    {safeStatusLabel(tTimeline, d.normalized_status ?? "new")}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            );
          })}
        </IndexTable>
        <Button
          variant="plain"
          url={withShopParams(
            "/app/disputes?normalized_status=in_progress,ready_to_submit,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank",
            sp,
          )}
        >
          {tDash("viewAllInProgress")} →
        </Button>
      </BlockStack>
    </Card>
  );
}

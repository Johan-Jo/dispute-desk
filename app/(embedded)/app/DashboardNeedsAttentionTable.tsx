"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  translateReason,
} from "./disputes/disputeListHelpers";
import { useDateLocale } from "./dashboardHelpers";

type DisputeWithScore = Dispute & { pack_completeness_score?: number | null };

function formatDeadlineLabel(
  dueAt: string | null,
  t: ReturnType<typeof useTranslations>,
): { label: string; tone: "critical" | "warning" | undefined } {
  if (!dueAt) return { label: "—", tone: undefined };
  const diffMs = new Date(dueAt).getTime() - Date.now();
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 0) return { label: t("overdue"), tone: "critical" };
  if (hours <= 24) return { label: t("dueToday"), tone: "critical" };
  if (hours <= 48) return { label: t("dueTomorrow"), tone: "warning" };
  const days = Math.round(hours / 24);
  return { label: t("dueInDays", { count: days }), tone: undefined };
}

function issueLabel(
  d: Dispute,
  t: ReturnType<typeof useTranslations>,
): { label: string; tone: "warning" | "critical" | "attention" } {
  if (d.normalized_status === "needs_review")
    return { label: t("issueNeedsReview"), tone: "attention" };
  if (d.normalized_status === "action_needed")
    return { label: t("issueActionNeeded"), tone: "warning" };
  if (d.submission_state === "not_saved" || !d.submission_state)
    return { label: t("issueMissingEvidence"), tone: "critical" };
  return { label: t("issueDeadlineSoon"), tone: "warning" };
}

function winChanceFromScore(
  score: number | null | undefined,
  t: ReturnType<typeof useTranslations>,
): { level: string; tone: "success" | "warning" | "critical"; boost: string } {
  if (score == null || score < 40)
    return { level: t("winChanceLow"), tone: "critical", boost: t("winBoostIfCompleted", { pct: 30 }) };
  if (score < 75)
    return { level: t("winChanceMedium"), tone: "warning", boost: t("winBoostIfCompleted", { pct: Math.min(25, 100 - score) }) };
  return { level: t("winChanceHigh"), tone: "success", boost: t("winBoostIfSubmitted", { pct: Math.min(22, 100 - score) }) };
}

export function DashboardNeedsAttentionTable() {
  const t = useTranslations("dashboard");
  const tRoot = useTranslations();
  const dateLocale = useDateLocale();
  const searchParams = useSearchParams();
  const [disputes, setDisputes] = useState<DisputeWithScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(
      "/api/disputes?normalized_status=new,action_needed,needs_review&sort=due_at&sort_dir=asc&per_page=10&include_pack_score=true",
    )
      .then((r) => (r.ok ? r.json() : { disputes: [] }))
      .then((data: { disputes?: DisputeWithScore[] }) => {
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
    { title: t("orderCol") },
    { title: t("amountCol") },
    { title: t("reasonCol") },
    { title: t("issueCol") },
    { title: t("deadlineCol") },
    { title: t("winChanceCol") },
    { title: t("actionsCol") },
  ];

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("needsYourAttention")} ({disputes.length})
          </Text>
          <Button
            variant="plain"
            url={withShopParams(
              "/app/disputes?normalized_status=new,action_needed,needs_review",
              sp,
            )}
          >
            {t("viewAllNeedingAttention")}
          </Button>
        </InlineStack>
        <IndexTable
          resourceName={{ singular: "dispute", plural: "disputes" }}
          itemCount={disputes.length}
          headings={headings}
          selectable={false}
        >
          {disputes.map((d, idx) => {
            const deadline = formatDeadlineLabel(d.due_at, t);
            const issue = issueLabel(d, t);
            const wc = winChanceFromScore(d.pack_completeness_score, t);
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
                  <Text as="span" variant="bodySm" tone="subdued">
                    {translateReason(d.reason, tRoot)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Badge tone={issue.tone}>{issue.label}</Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {issue.label === t("issueMissingEvidence")
                        ? t("issueDeliveryProof")
                        : issue.label === t("issueActionNeeded")
                          ? t("issueCustomerAuth")
                          : t("issueSubmitEvidence")}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodySm">
                      {d.due_at
                        ? new Date(d.due_at).toLocaleDateString(dateLocale, {
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </Text>
                    {deadline.tone ? (
                      <Text as="span" variant="bodySm" tone={deadline.tone === "critical" ? "critical" : "caution"}>
                        {deadline.label}
                      </Text>
                    ) : (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {deadline.label}
                      </Text>
                    )}
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Badge tone={wc.tone}>{wc.level}</Badge>
                    <Text as="span" variant="bodySm" tone="success">
                      {wc.boost}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link
                    href={withShopParams(`/app/disputes/${d.id}`, sp)}
                    style={{ textDecoration: "none" }}
                  >
                    <Button size="slim" variant="plain">
                      {t("reviewAction")} →
                    </Button>
                  </Link>
                </IndexTable.Cell>
              </IndexTable.Row>
            );
          })}
        </IndexTable>
        <Button
          variant="plain"
          url={withShopParams(
            "/app/disputes?normalized_status=new,action_needed,needs_review",
            sp,
          )}
        >
          {t("viewAllNeedingAttention")} →
        </Button>
      </BlockStack>
    </Card>
  );
}

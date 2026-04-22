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

function issueLabel(d: Dispute): string {
  if (d.normalized_status === "needs_review") return "Needs review";
  if (d.normalized_status === "action_needed") return "Action needed";
  if (d.submission_state === "not_saved" || !d.submission_state)
    return "Missing evidence";
  return "New dispute";
}

export function DashboardNeedsAttentionTable() {
  const t = useTranslations("dashboard");
  const tRoot = useTranslations();
  const dateLocale = useDateLocale();
  const searchParams = useSearchParams();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(
      "/api/disputes?normalized_status=new,action_needed,needs_review&sort=due_at&sort_dir=asc&per_page=10",
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
    { title: t("orderCol") },
    { title: t("reasonCol") },
    { title: t("issueCol") },
    { title: t("deadlineCol") },
    { title: t("amountCol") },
    { title: t("nextStepCol") },
  ];

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            {t("needsYourAttention")}
          </Text>
          <Button
            variant="plain"
            url={withShopParams(
              "/app/disputes?normalized_status=new,action_needed,needs_review",
              sp,
            )}
          >
            {tRoot("common.viewAll")}
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
            return (
              <IndexTable.Row key={d.id} id={d.id} position={idx}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {orderLabel(d)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {translateReason(d.reason, tRoot)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone="warning">{issueLabel(d)}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {deadline.tone ? (
                    <Badge tone={deadline.tone}>{deadline.label}</Badge>
                  ) : (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {deadline.label}
                    </Text>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {formatCurrency(d.amount, d.currency_code, dateLocale)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link
                    href={withShopParams(`/app/disputes/${d.id}`, sp)}
                    style={{ textDecoration: "none" }}
                  >
                    <Button size="slim">
                      {t("reviewCol")}
                    </Button>
                  </Link>
                </IndexTable.Cell>
              </IndexTable.Row>
            );
          })}
        </IndexTable>
      </BlockStack>
    </Card>
  );
}

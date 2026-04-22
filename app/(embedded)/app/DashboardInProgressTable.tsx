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
  NORMALIZED_STATUS_TONE,
} from "./disputes/disputeListHelpers";
import { safeStatusLabel, useDateLocale } from "./dashboardHelpers";

function submissionBadge(
  state: string | null | undefined,
  t: ReturnType<typeof useTranslations>,
): { label: string; tone: "success" | "info" | "attention" | undefined } {
  switch (state) {
    case "saved_to_shopify":
      return { label: t("dashboard.savedToShopify"), tone: "success" };
    case "submitted_confirmed":
      return { label: t("status.complete"), tone: "success" };
    case "submission_uncertain":
      return { label: t("status.pending"), tone: "attention" };
    case "manual_submission_reported":
      return { label: t("status.complete"), tone: "success" };
    default:
      return { label: t("status.pending"), tone: undefined };
  }
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
      "/api/disputes?normalized_status=in_progress,ready_to_submit,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank&sort=due_at&sort_dir=asc&per_page=10",
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
    { title: tDash("reasonCol") },
    { title: tDash("amountCol") },
    { title: tDash("submittedDateCol") },
    { title: tDash("submissionStatusCol") },
    { title: tDash("statusCol") },
    { title: tDash("actionsCol") },
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
            {tDash("inProgress")}
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
            const sub = submissionBadge(d.submission_state, t);
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
                  <Text as="span" variant="bodySm" tone="subdued">
                    {translateReason(d.reason, t)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {formatCurrency(d.amount, d.currency_code, dateLocale)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {formatDate(d.submitted_at)}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={sub.tone}>{sub.label}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={statusTone}>
                    {safeStatusLabel(tTimeline, d.normalized_status ?? "new")}
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link
                    href={withShopParams(`/app/disputes/${d.id}`, sp)}
                    style={{ textDecoration: "none" }}
                  >
                    <Button size="slim" variant="plain">
                      {t("table.viewDetails")}
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

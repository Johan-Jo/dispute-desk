"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Card, InlineGrid, BlockStack, Text } from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import { useFormatCurrency, type DashboardStats } from "./dashboardHelpers";
import Link from "next/link";

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

interface TileProps {
  label: string;
  value: string;
  tone?: "critical" | "warning" | "subdued";
  url?: string;
}

function SummaryTile({ label, value, tone, url }: TileProps) {
  const badgeTone =
    tone === "critical" ? "critical" : tone === "warning" ? "warning" : undefined;

  const content = (
    <Card>
      <BlockStack gap="200">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        {badgeTone ? (
          <Badge tone={badgeTone} size="large">
            {value}
          </Badge>
        ) : (
          <Text as="p" variant="headingLg">
            {value}
          </Text>
        )}
      </BlockStack>
    </Card>
  );

  if (url) {
    return (
      <Link href={url} style={{ textDecoration: "none", color: "inherit" }}>
        {content}
      </Link>
    );
  }
  return content;
}

export function DashboardSummaryRow({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const formatCurrency = useFormatCurrency(stats.currencyCode);

  const ob = stats.operationalBreakdown;
  const actionNeeded =
    (ob["new"] ?? 0) + (ob["action_needed"] ?? 0) + (ob["needs_review"] ?? 0);
  const inProgress =
    (ob["in_progress"] ?? 0) +
    (ob["ready_to_submit"] ?? 0) +
    (ob["submitted"] ?? 0) +
    (ob["submitted_to_shopify"] ?? 0) +
    (ob["waiting_on_issuer"] ?? 0) +
    (ob["submitted_to_bank"] ?? 0);

  const sp = searchParams ?? new URLSearchParams();

  return (
    <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
      <SummaryTile
        label={t("actionNeeded")}
        value={loading ? "—" : String(actionNeeded)}
        tone={actionNeeded > 0 ? "critical" : undefined}
        url={
          actionNeeded > 0
            ? withShopParams(
                "/app/disputes?normalized_status=new,action_needed,needs_review",
                sp,
              )
            : undefined
        }
      />
      <SummaryTile
        label={t("inProgress")}
        value={loading ? "—" : String(inProgress)}
        url={
          inProgress > 0
            ? withShopParams(
                "/app/disputes?normalized_status=in_progress,ready_to_submit,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank",
                sp,
              )
            : undefined
        }
      />
      <SummaryTile
        label={t("amountAtRisk")}
        value={loading ? "—" : formatCurrency(stats.amountAtRisk)}
      />
      <SummaryTile
        label={t("deadlinesSoon")}
        value={loading ? "—" : String(stats.deadlinesSoonCount)}
        tone={stats.deadlinesSoonCount > 0 ? "warning" : undefined}
      />
    </InlineGrid>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BlockStack,
  Button,
  Card,
  Icon,
  InlineGrid,
  InlineStack,
  Text,
  useBreakpoints,
} from "@shopify/polaris";
import { AlertTriangleIcon } from "@shopify/polaris-icons";
import Link from "next/link";
import { withShopParams } from "@/lib/withShopParams";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

type TileTone = "critical" | "warning" | "info";

interface TileProps {
  tone: TileTone;
  value: string;
  label: string;
  sub: string;
  url?: string;
}

const TILE_COLORS: Record<
  TileTone,
  { bg: string; border: string; value: string }
> = {
  critical: { bg: "#FEF2F2", border: "#FCA5A5", value: "#B91C1C" },
  warning: { bg: "#FFFBEB", border: "#FCD34D", value: "#B45309" },
  info: { bg: "#EFF6FF", border: "#93C5FD", value: "#1D4ED8" },
};

function StatTile({ tone, value, label, sub, url }: TileProps) {
  const c = TILE_COLORS[tone];
  const inner = (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: 16,
        height: "100%",
        minHeight: 104,
        boxSizing: "border-box",
      }}
    >
      <BlockStack gap="100">
        <Text as="p" variant="heading2xl">
          <span style={{ color: c.value }}>{value}</span>
        </Text>
        <Text as="p" variant="bodyMd" fontWeight="medium">
          {label}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {sub}
        </Text>
      </BlockStack>
    </div>
  );
  if (url) {
    return (
      <Link href={url} style={{ textDecoration: "none", color: "inherit" }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

export function DashboardSummaryRow({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const { mdDown } = useBreakpoints();

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
  const missingEvidence = stats.submissionBreakdown["not_saved"] ?? 0;

  const sp = searchParams ?? new URLSearchParams();
  const reviewUrl = withShopParams(
    "/app/disputes?normalized_status=new,action_needed,needs_review",
    sp,
  );
  const missingEvidenceUrl = withShopParams(
    "/app/disputes?submission_state=not_saved",
    sp,
  );
  const inProgressUrl = withShopParams(
    "/app/disputes?normalized_status=in_progress,ready_to_submit,submitted,submitted_to_shopify,waiting_on_issuer,submitted_to_bank",
    sp,
  );

  const val = (n: number) => (loading ? "—" : String(n));

  const hasPriority = actionNeeded > 0;

  const iconChip = (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        background: hasPriority ? "#FEE2E2" : "#D1FAE5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: hasPriority ? "#B91C1C" : "#047857",
      }}
    >
      <Icon source={AlertTriangleIcon} />
    </div>
  );

  const banner = (
    <BlockStack gap="300">
      <InlineStack gap="300" blockAlign="start" wrap={false}>
        {iconChip}
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {hasPriority
              ? t("priorityActionsNeeded")
              : t("nothingNeedsAttention")}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {hasPriority
              ? t("priorityActionsDescription", { count: actionNeeded })
              : t("priorityActionsZeroDesc")}
          </Text>
        </BlockStack>
      </InlineStack>
      {hasPriority ? (
        <InlineStack>
          <Button variant="primary" url={reviewUrl}>
            {t("reviewNow")}
          </Button>
        </InlineStack>
      ) : null}
    </BlockStack>
  );

  const tiles = (
    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
      <StatTile
        tone="critical"
        value={val(actionNeeded)}
        label={t("actionNeeded")}
        sub={t("needsActionSub")}
        url={actionNeeded > 0 ? reviewUrl : undefined}
      />
      <StatTile
        tone="warning"
        value={val(missingEvidence)}
        label={t("missingEvidenceTile")}
        sub={t("missingEvidenceSub")}
        url={missingEvidence > 0 ? missingEvidenceUrl : undefined}
      />
      <StatTile
        tone="info"
        value={val(inProgress)}
        label={t("inProgress")}
        sub={t("inProgressSub")}
        url={inProgress > 0 ? inProgressUrl : undefined}
      />
    </InlineGrid>
  );

  return (
    <Card>
      {mdDown ? (
        <BlockStack gap="400">
          {banner}
          {tiles}
        </BlockStack>
      ) : (
        <InlineGrid columns="1fr 2fr" gap="400">
          {banner}
          {tiles}
        </InlineGrid>
      )}
    </Card>
  );
}

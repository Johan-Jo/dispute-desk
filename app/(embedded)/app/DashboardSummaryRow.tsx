"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { withShopParams } from "@/lib/withShopParams";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

interface StatTileProps {
  value: string;
  label: string;
  sublabel: string;
  bg: string;
  color: string;
}

function StatTile({ value, label, sublabel, bg, color }: StatTileProps) {
  return (
    <div
      style={{
        background: bg,
        borderRadius: "var(--p-border-radius-200)",
        padding: "12px 16px",
        minWidth: 0,
      }}
    >
      <BlockStack gap="050">
        <Text as="p" variant="headingLg">
          <span style={{ color }}>{value}</span>
        </Text>
        <Text as="span" variant="bodySm" fontWeight="semibold">
          <span style={{ color }}>{label}</span>
        </Text>
        <Text as="span" variant="bodySm">
          <span style={{ color, opacity: 0.8 }}>{sublabel}</span>
        </Text>
      </BlockStack>
    </div>
  );
}

export function DashboardSummaryRow({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();
  const sp = searchParams ?? new URLSearchParams();

  const ob = stats.operationalBreakdown;
  const actionNeeded =
    (ob["new"] ?? 0) + (ob["action_needed"] ?? 0) + (ob["needs_review"] ?? 0);

  const reviewUrl = withShopParams(
    "/app/disputes?normalized_status=new,action_needed,needs_review",
    sp,
  );

  const tiles = (
    <InlineGrid columns={3} gap="300">
      <StatTile
        value={loading ? "—" : String(actionNeeded)}
        label={t("needAction")}
        sublabel={
          loading
            ? "—"
            : t("dueTodaySub", { count: stats.dueTodayCount })
        }
        bg={actionNeeded > 0 ? "#FEF2F2" : "#F3F4F6"}
        color={actionNeeded > 0 ? "#DC2626" : "#374151"}
      />
      <StatTile
        value={loading ? "—" : String(stats.missingEvidenceCount)}
        label={t("missingEvidence")}
        sublabel={t("addEvidence")}
        bg={stats.missingEvidenceCount > 0 ? "#FFF7ED" : "#F3F4F6"}
        color={stats.missingEvidenceCount > 0 ? "#EA580C" : "#374151"}
      />
      <StatTile
        value={loading ? "—" : String(stats.deadlinesSoonCount)}
        label={t("deadlinesSoon")}
        sublabel={t("dueThisWeek")}
        bg={stats.deadlinesSoonCount > 0 ? "#FFF7ED" : "#F3F4F6"}
        color={stats.deadlinesSoonCount > 0 ? "#EA580C" : "#374151"}
      />
    </InlineGrid>
  );

  if (actionNeeded === 0 && !loading) {
    return tiles;
  }

  return (
    <InlineGrid columns={{ xs: 1, md: "2fr 1fr" }} gap="300">
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Box>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "#FEF3C7",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                ⚠
              </div>
            </Box>
            <BlockStack gap="050">
              <Text as="p" variant="headingSm">
                {t("disputesNeedAttention", { count: actionNeeded })}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {t("reviewToImproveWinRate")}
              </Text>
            </BlockStack>
          </InlineStack>
          <div>
            <Button variant="primary" url={reviewUrl}>
              {t("reviewDisputesNow")}
            </Button>
          </div>
        </BlockStack>
      </Card>
      {tiles}
    </InlineGrid>
  );
}

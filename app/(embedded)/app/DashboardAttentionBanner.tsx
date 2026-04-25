"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@shopify/polaris";
import { AlertCircleIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
}

export function DashboardAttentionBanner({ stats }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();

  const actionNeeded =
    (stats.operationalBreakdown["new"] ?? 0) +
    (stats.operationalBreakdown["action_needed"] ?? 0) +
    (stats.operationalBreakdown["needs_review"] ?? 0);

  if (actionNeeded === 0) return null;

  const reviewUrl =
    actionNeeded === 1 && stats.actionNeededDisputeId
      ? withShopParams(`/app/disputes/${stats.actionNeededDisputeId}`, searchParams ?? new URLSearchParams())
      : withShopParams(
          "/app/disputes?normalized_status=new,action_needed,needs_review",
          searchParams ?? new URLSearchParams(),
        );

  return (
    <div
      style={{
        background: "#FEF2F2",
        border: "1px solid #FCA5A5",
        borderRadius: "8px",
        padding: "16px",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
      }}
    >
      <div style={{ width: 20, height: 20, color: "#DC2626", flexShrink: 0, marginTop: 2 }}>
        <Icon source={AlertCircleIcon} tone="critical" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: "14px", color: "#202223", margin: 0 }}>
          {t("attentionBannerMessage", { count: actionNeeded })}
        </p>
      </div>
      <a
        href={reviewUrl}
        style={{
          padding: "6px 12px",
          border: "1px solid #DC2626",
          borderRadius: "6px",
          fontSize: "14px",
          fontWeight: 500,
          color: "#DC2626",
          background: "transparent",
          textDecoration: "none",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        {t("attentionBannerCta")}
      </a>
    </div>
  );
}

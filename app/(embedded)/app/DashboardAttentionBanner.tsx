"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@shopify/polaris";
import { AlertCircleIcon, ShieldCheckMarkIcon } from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
}

/**
 * State-driven dashboard banner (design-alignment plan §4 / mockup
 * `renderBanner`). Two states:
 *
 *  - merchantActionCount > 0 → "{n} disputes need your attention" —
 *    genuine merchant tasks ONLY (blocking / requested /
 *    merchant-resolvable technical errors), never every active dispute.
 *  - merchantActionCount === 0 → neutral operational banner:
 *    "DisputeDesk is monitoring {n} active disputes / No action is
 *    currently required from you." Calm blue, never warning colors.
 */
export function DashboardAttentionBanner({ stats }: Props) {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();

  const merchantActionCount = stats.merchantActionCount ?? 0;
  const activeCount = stats.activeDisputes ?? 0;

  if (merchantActionCount > 0) {
    const reviewUrl = withShopParams(
      "/app/disputes?attention=tasks",
      searchParams ?? new URLSearchParams(),
    );
    return (
      <div
        style={{
          background: "#FFF7F5",
          border: "1px solid #F3C6BE",
          borderRadius: "12px",
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
        }}
      >
        <div style={{ width: 20, height: 20, color: "#B42318", flexShrink: 0 }}>
          <Icon source={AlertCircleIcon} tone="critical" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#7A271A", margin: 0 }}>
            {t("attentionBannerMessage", { count: merchantActionCount })}
          </p>
          <p style={{ fontSize: 12.5, color: "#B42318", margin: "2px 0 0" }}>
            {t("attentionBannerBody")}
          </p>
        </div>
        <a
          href={reviewUrl}
          style={{
            padding: "8px 13px",
            border: "1px solid #F3C6BE",
            borderRadius: "8px",
            fontSize: 13,
            fontWeight: 600,
            color: "#B42318",
            background: "#ffffff",
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

  // Neutral monitoring banner — shown even with zero tasks so the
  // merchant always sees what DisputeDesk is doing (calm, not alarming).
  if (activeCount === 0) return null;
  const viewUrl = withShopParams("/app/disputes", searchParams ?? new URLSearchParams());
  return (
    <div
      style={{
        background: "#F4F8FF",
        border: "1px solid #CFE0F7",
        borderRadius: "12px",
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: "14px",
      }}
    >
      <div style={{ width: 20, height: 20, color: "#005BD3", flexShrink: 0 }}>
        <Icon source={ShieldCheckMarkIcon} tone="info" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#1F3A5F", margin: 0 }}>
          {t("monitoringBannerTitle", { count: activeCount })}
        </p>
        <p style={{ fontSize: 12.5, color: "#3F5B80", margin: "2px 0 0" }}>
          {t("monitoringBannerBody")}
        </p>
      </div>
      <a
        href={viewUrl}
        style={{
          padding: "8px 13px",
          border: "1px solid #CFE0F7",
          borderRadius: "8px",
          fontSize: 13,
          fontWeight: 600,
          color: "#005BD3",
          background: "#ffffff",
          textDecoration: "none",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        {t("monitoringBannerCta")}
      </a>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@shopify/polaris";
import {
  ChartLineIcon,
  CheckCircleIcon,
  WandIcon,
} from "@shopify/polaris-icons";
import { withShopParams } from "@/lib/withShopParams";

interface ActionSpec {
  key: string;
  label: string;
  icon: typeof ChartLineIcon;
  url: string;
}

export function DashboardQuickActions() {
  const t = useTranslations("dashboard");
  const searchParams = useSearchParams();

  const actions: ActionSpec[] = [
    {
      key: "manage_cases",
      label: t("quickActionManageCases"),
      icon: ChartLineIcon,
      url: withShopParams("/app/disputes", searchParams ?? new URLSearchParams()),
    },
    {
      key: "configure_packs",
      label: t("quickActionConfigurePacks"),
      icon: CheckCircleIcon,
      url: withShopParams("/app/coverage", searchParams ?? new URLSearchParams()),
    },
    {
      key: "automation_rules",
      label: t("quickActionAutomationRules"),
      icon: WandIcon,
      url: withShopParams("/app/rules", searchParams ?? new URLSearchParams()),
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "12px",
      }}
    >
      {actions.map((a) => (
        <Link
          key={a.key}
          href={a.url}
          style={{
            display: "block",
            background: "#fff",
            border: "1px solid #E1E3E5",
            borderRadius: "8px",
            padding: "16px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ width: 20, height: 20, color: "#005BD3", display: "inline-flex" }}>
              <Icon source={a.icon} tone="info" />
            </span>
            <span style={{ fontSize: "14px", fontWeight: 500, color: "#202223" }}>{a.label}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

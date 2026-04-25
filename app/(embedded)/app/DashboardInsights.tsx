"use client";

import { useTranslations } from "next-intl";
import { BlockStack, Card, Spinner, Text } from "@shopify/polaris";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

export function DashboardInsights({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const tPacks = useTranslations("packs");

  const translateCategory = (label: string) => {
    try {
      return tPacks(`disputeTypeLabel.${label}`);
    } catch {
      /* fallback */
    }
    return label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const trend = stats.winRateTrend.length ? stats.winRateTrend : [0, 0, 0, 0];
  const trendMax = Math.max(...trend, 1);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">{t("insightsTitle")}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{t("insightsSubtitle")}</Text>
        </BlockStack>

        {loading ? (
          <Spinner size="small" />
        ) : (
          <BlockStack gap="500">
            <div>
              <p style={{ fontSize: "14px", fontWeight: 500, color: "#202223", margin: "0 0 12px" }}>
                {t("winRateTrend")}
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "8px",
                  height: "96px",
                }}
              >
                {trend.map((v, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      background: i === trend.length - 1 ? "#005BD3" : "#E1E3E5",
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      height: `${Math.max(8, (v / trendMax) * 100)}%`,
                      minHeight: 8,
                    }}
                    aria-label={`${v}%`}
                  />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                {trend.map((_, i) => (
                  <span key={i} style={{ fontSize: "12px", color: "#6D7175" }}>
                    W{i + 1}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p style={{ fontSize: "14px", fontWeight: 500, color: "#202223", margin: "0 0 12px" }}>
                {t("disputeCategories")}
              </p>
              {stats.disputeCategories.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("noDisputesYetDesc")}
                </Text>
              ) : (
                <BlockStack gap="300">
                  {stats.disputeCategories.map(({ label, value }) => (
                    <div key={label}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "14px",
                          marginBottom: "4px",
                        }}
                      >
                        <span style={{ color: "#202223" }}>{translateCategory(label)}</span>
                        <span style={{ color: "#6D7175" }}>{value}%</span>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "8px",
                          background: "#E1E3E5",
                          borderRadius: "9999px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${value}%`,
                            height: "100%",
                            background: "#005BD3",
                            borderRadius: "9999px",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </BlockStack>
              )}
            </div>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

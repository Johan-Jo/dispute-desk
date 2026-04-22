"use client";

import { useTranslations } from "next-intl";
import {
  BlockStack,
  Card,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import type { DashboardStats } from "./dashboardHelpers";

interface Props {
  stats: DashboardStats;
  loading: boolean;
}

export function DashboardCategories({ stats, loading }: Props) {
  const t = useTranslations("dashboard");
  const tPacks = useTranslations("packs");

  const translateCategory = (label: string) => {
    try {
      return tPacks(`disputeTypeLabel.${label}`);
    } catch {
      return label
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };

  if (loading) return null;
  if (stats.disputeCategories.length === 0) return null;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("disputeCategories")}
        </Text>
        <BlockStack gap="300">
          {stats.disputeCategories.map(({ label, value }) => (
            <BlockStack key={label} gap="100">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodyMd">
                  {translateCategory(label)}
                </Text>
                <Text as="span" variant="bodyMd" tone="subdued">
                  {value}%
                </Text>
              </InlineStack>
              <ProgressBar progress={value} size="small" />
            </BlockStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

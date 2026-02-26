"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  ProgressBar,
  Spinner,
  Banner,
  Divider,
} from "@shopify/polaris";

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  packsPerMonth: number | null;
  autoPack: boolean;
  rules: boolean;
}

interface UsageInfo {
  packsUsed: number;
  packsLimit: number | null;
  packsRemaining: number | null;
}

const PLAN_FEATURE_KEYS: Record<string, string[]> = {
  free: ["billing.freeFeature1", "billing.freeFeature2", "billing.freeFeature3", "billing.freeFeature4"],
  starter: ["billing.realStarterFeature1", "billing.realStarterFeature2", "billing.realStarterFeature3", "billing.realStarterFeature4", "billing.realStarterFeature5"],
  growth: ["billing.growthFeature1", "billing.growthFeature2", "billing.growthFeature3", "billing.growthFeature4", "billing.growthFeature5"],
  scale: ["billing.scaleFeature1", "billing.scaleFeature2", "billing.scaleFeature3", "billing.scaleFeature4", "billing.scaleFeature5"],
};

const PLAN_IDS = ["free", "starter", "growth", "scale"] as const;

const PLAN_PRICES: Record<string, { price: number; label: string }> = {
  free: { price: 0, label: "$0" },
  starter: { price: 29, label: "$29/mo" },
  growth: { price: 79, label: "$79/mo" },
  scale: { price: 149, label: "$149/mo" },
};

const TOP_UPS = [
  { sku: "topup_25", labelKey: "billing.topUp25", price: "$19" },
  { sku: "topup_100", labelKey: "billing.topUp100", price: "$59" },
];

export default function BillingPage() {
  const t = useTranslations();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  const shopId = typeof window !== "undefined"
    ? document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? ""
    : "";

  const fetchUsage = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const res = await fetch(`/api/billing/usage?shop_id=${shopId}`);
    const data = await res.json();
    setPlan(data.plan);
    setUsage(data.usage);
    setLoading(false);
  }, [shopId]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    const res = await fetch("/api/billing/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shopId, plan_id: planId }),
    });
    const data = await res.json();
    if (data.confirmationUrl) {
      window.top!.location.href = data.confirmationUrl;
    }
    setUpgrading(null);
  };

  if (loading) {
    return (
      <Page title={t("billing.title")}>
        <div style={{ padding: "3rem", textAlign: "center" }}>
          <Spinner size="large" />
        </div>
      </Page>
    );
  }

  const usagePercent =
    usage && usage.packsLimit
      ? Math.min(100, Math.round((usage.packsUsed / usage.packsLimit) * 100))
      : 0;

  const planNameKeys: Record<string, string> = {
    free: "billing.free",
    starter: "billing.starter",
    growth: "billing.growth",
    scale: "billing.scale",
  };

  return (
    <Page
      title={t("billing.title")}
      subtitle={`${t("billing.currentPlan")}: ${plan ? t(planNameKeys[plan.id] ?? "billing.free") : t("billing.free")}`}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("billing.usageThisMonth")}</Text>
              {usage?.packsLimit != null ? (
                <>
                  <Text as="p" variant="bodyMd">
                    {t("billing.packsUsed", { used: usage.packsUsed, limit: usage.packsLimit })}
                  </Text>
                  <ProgressBar progress={usagePercent} tone={usagePercent >= 90 ? "critical" : undefined} />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("billing.packsRemaining", { count: usage.packsRemaining ?? 0 })}
                  </Text>
                </>
              ) : (
                <Text as="p" variant="bodyMd">{t("billing.noPackCredits")}</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Text as="h2" variant="headingMd">{t("billing.plans")}</Text>
        </Layout.Section>

        {PLAN_IDS.map((planId) => {
          const priceInfo = PLAN_PRICES[planId];
          const featureKeys = PLAN_FEATURE_KEYS[planId];
          return (
            <Layout.Section key={planId} variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingMd">{t(planNameKeys[planId])}</Text>
                    {plan?.id === planId && <Badge tone="success">{t("billing.yourCurrentPlan")}</Badge>}
                  </InlineStack>
                  <Text as="p" variant="headingLg">{priceInfo.label}</Text>
                  <Divider />
                  <BlockStack gap="100">
                    {featureKeys.map((key) => (
                      <Text key={key} as="p" variant="bodySm">✓ {t(key)}</Text>
                    ))}
                  </BlockStack>
                  {plan?.id !== planId && priceInfo.price > (plan?.price ?? 0) && (
                    <Button
                      variant="primary"
                      loading={upgrading === planId}
                      onClick={() => handleUpgrade(planId)}
                    >
                      {priceInfo.price > 0
                        ? t("billing.startTrial", { plan: t(planNameKeys[planId]) })
                        : t(planNameKeys[planId])}
                    </Button>
                  )}
                  {plan?.id === planId && (
                    <Banner tone="info">
                      {t("billing.yourCurrentPlan")}
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          );
        })}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("billing.topUps")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("billing.topUpsDesc")}
              </Text>
              <InlineStack gap="300">
                {TOP_UPS.map((topUp) => (
                  <Button
                    key={topUp.sku}
                    onClick={async () => {
                      const res = await fetch("/api/billing/topup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shop_id: shopId, sku: topUp.sku }),
                      });
                      const data = await res.json();
                      if (data.confirmationUrl) window.top!.location.href = data.confirmationUrl;
                    }}
                  >
                    {t(topUp.labelKey)} — {topUp.price}
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <div style={{ padding: "0.5rem 0", textAlign: "center" }}>
        <Text as="p" variant="bodySm" tone="subdued">
          {t("billing.trialNote")}
        </Text>
      </div>
    </Page>
  );
}

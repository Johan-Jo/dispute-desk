"use client";

import { useState, useEffect, useCallback } from "react";
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

const ALL_PLANS: { id: string; name: string; price: number; features: string[] }[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    features: ["3 packs/month", "Manual generation only", "PDF export", "Save to Shopify"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    features: ["50 packs/month", "Auto-pack on sync", "Custom rules", "PDF export", "Save to Shopify"],
  },
  {
    id: "pro",
    name: "Pro",
    price: 79,
    features: ["Unlimited packs", "Auto-pack on sync", "Custom rules", "PDF export", "Save to Shopify", "Priority support"],
  },
];

export default function BillingPage() {
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
      <Page title="Billing">
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

  return (
    <Page title="Billing" subtitle={`Current plan: ${plan?.name ?? "Free"}`}>
      <Layout>
        {/* Usage */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Usage This Month</Text>
              {usage?.packsLimit != null ? (
                <>
                  <Text as="p" variant="bodyMd">
                    {usage.packsUsed} of {usage.packsLimit} packs used
                  </Text>
                  <ProgressBar progress={usagePercent} tone={usagePercent >= 90 ? "critical" : undefined} />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {usage.packsRemaining} remaining
                  </Text>
                </>
              ) : (
                <Text as="p" variant="bodyMd">Unlimited packs</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Plans */}
        <Layout.Section>
          <Text as="h2" variant="headingMd">Plans</Text>
        </Layout.Section>

        {ALL_PLANS.map((p) => (
          <Layout.Section key={p.id} variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">{p.name}</Text>
                  {plan?.id === p.id && <Badge tone="success">Current</Badge>}
                </InlineStack>
                <Text as="p" variant="headingLg">
                  {p.price === 0 ? "Free" : `$${p.price}/mo`}
                </Text>
                <Divider />
                <BlockStack gap="100">
                  {p.features.map((f) => (
                    <Text key={f} as="p" variant="bodySm">✓ {f}</Text>
                  ))}
                </BlockStack>
                {plan?.id !== p.id && p.price > (plan?.price ?? 0) && (
                  <Button
                    variant="primary"
                    loading={upgrading === p.id}
                    onClick={() => handleUpgrade(p.id)}
                  >
                    Upgrade to {p.name}
                  </Button>
                )}
                {plan?.id === p.id && (
                  <Banner tone="info">
                    You&apos;re on this plan.
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        ))}
      </Layout>
    </Page>
  );
}

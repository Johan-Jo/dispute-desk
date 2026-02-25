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

const ALL_PLANS: { id: string; name: string; price: number; label: string; features: string[] }[] = [
  {
    id: "free",
    name: "Free (Sandbox)",
    price: 0,
    label: "$0",
    features: ["Unlimited draft building", "3 exported packs (lifetime)", "Basic activity log", "PDF export"],
  },
  {
    id: "starter",
    name: "Starter",
    price: 29,
    label: "$29/mo",
    features: ["15 packs/month", "Basic rules (up to 5)", "Auto-build packs", "Review queue", "Email support"],
  },
  {
    id: "growth",
    name: "Growth",
    price: 79,
    label: "$79/mo",
    features: ["75 packs/month", "Advanced rules", "Multi-user", "Bulk actions", "Auto-save to Shopify"],
  },
  {
    id: "scale",
    name: "Scale",
    price: 149,
    label: "$149/mo",
    features: ["300 packs/month", "Multi-store", "Advanced exports", "SLA options", "Priority support"],
  },
];

const TOP_UPS = [
  { sku: "topup_25", label: "+25 packs", price: "$19" },
  { sku: "topup_100", label: "+100 packs", price: "$59" },
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
                <Text as="p" variant="bodyMd">No pack credits remaining.</Text>
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
                <Text as="p" variant="headingLg">{p.label}</Text>
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
                    {p.price > 0 ? `Start 14-Day Trial — ${p.name}` : `Switch to ${p.name}`}
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

        {/* Top-ups */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Need more packs?</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Purchase top-up bundles. Credits added immediately upon payment.
              </Text>
              <InlineStack gap="300">
                {TOP_UPS.map((t) => (
                  <Button
                    key={t.sku}
                    onClick={async () => {
                      const res = await fetch("/api/billing/topup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shop_id: shopId, sku: t.sku }),
                      });
                      const data = await res.json();
                      if (data.confirmationUrl) window.top!.location.href = data.confirmationUrl;
                    }}
                  >
                    {t.label} — {t.price}
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <div style={{ padding: "0.5rem 0", textAlign: "center" }}>
        <Text as="p" variant="bodySm" tone="subdued">
          Paid plans include a 14-day trial with 25 packs. Downgrades take effect at the next billing cycle.
        </Text>
      </div>
    </Page>
  );
}

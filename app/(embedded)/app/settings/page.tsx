/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/settings/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-settings.tsx
 * Reference: Settings sections: Store Connection, Notifications (3 toggles),
 * Team Members (with Invite), Billing & Plan card, Security & Privacy.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  Checkbox,
  Spinner,
  Divider,
} from "@shopify/polaris";

interface ShopInfo {
  shopDomain?: string;
  lastSyncedAt?: string | null;
  plan?: { name: string };
}

interface NotificationPrefs {
  newDispute: boolean;
  beforeDue: boolean;
  evidenceReady: boolean;
}

export default function EmbeddedSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [notifNewDispute, setNotifNewDispute] = useState(true);
  const [notifBeforeDue, setNotifBeforeDue] = useState(true);
  const [notifEvidenceReady, setNotifEvidenceReady] = useState(false);

  const shopId =
    typeof window !== "undefined"
      ? document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? ""
      : "";

  const fetchInfo = useCallback(async () => {
    if (!shopId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [usageRes, prefsRes] = await Promise.all([
        fetch(`/api/billing/usage?shop_id=${shopId}`),
        fetch(`/api/shop/preferences?shop_id=${shopId}`),
      ]);
      if (usageRes.ok) {
        const data = await usageRes.json();
        setShopInfo({
          shopDomain: data.shop_domain ?? undefined,
          plan: data.plan ? { name: data.plan.name ?? "Free" } : { name: "Free" },
        });
      }
      if (prefsRes.ok) {
        const prefs = await prefsRes.json();
        const n = prefs.notifications as NotificationPrefs | undefined;
        if (n) {
          setNotifNewDispute(n.newDispute);
          setNotifBeforeDue(n.beforeDue);
          setNotifEvidenceReady(n.evidenceReady);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  const persistNotification = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      if (!shopId) return;
      await fetch("/api/shop/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shopId, notifications: { [key]: value } }),
      });
    },
    [shopId]
  );

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  return (
    <Page
      title={tn("settings")}
      subtitle={t("subtitle")}
    >
      <Layout>
        {/* Store Connection */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#E0F2FE",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  🔗
                </div>
                <Text as="h2" variant="headingMd">{t("storeConnection")}</Text>
              </InlineStack>
              <Divider />
              {loading ? (
                <Spinner size="small" />
              ) : (
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <InlineStack gap="300" blockAlign="center">
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        background: "#96BF48",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontWeight: 700,
                        fontSize: 16,
                      }}
                    >
                      S
                    </div>
                    <BlockStack gap="100">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {shopInfo?.shopDomain ?? tc("notAvailable")}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t("connectedViaOAuth")}
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone="success">Active</Badge>
                      </InlineStack>
                    </BlockStack>
                  </InlineStack>
                  <Button variant="secondary" url="/app/session-required">
                    {t("reconnect")}
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Notifications */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#DCFCE7",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  🔔
                </div>
                <Text as="h2" variant="headingMd">{t("notifications")}</Text>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifNewDispute")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifNewDisputeDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifNewDispute}
                      onChange={(v) => { setNotifNewDispute(v); void persistNotification("newDispute", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifBeforeDue")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifBeforeDueDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifBeforeDue}
                      onChange={(v) => { setNotifBeforeDue(v); void persistNotification("beforeDue", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
                <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="medium">{t("notifEvidenceReady")}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{t("notifEvidenceReadyDesc")}</Text>
                    </BlockStack>
                    <Checkbox
                      label=""
                      checked={notifEvidenceReady}
                      onChange={(v) => { setNotifEvidenceReady(v); void persistNotification("evidenceReady", v); }}
                      labelHidden
                    />
                  </InlineStack>
                </div>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Team Members */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      background: "#FEF3C7",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                    }}
                  >
                    👥
                  </div>
                  <Text as="h2" variant="headingMd">{t("teamMembers")}</Text>
                </InlineStack>
                <Button variant="primary" url="/portal/team">
                  {t("inviteMember")}
                </Button>
              </InlineStack>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">{t("teamManagedInPortal")}</Text>
              <Button url="/portal/team" variant="plain">{t("manageTeam")}</Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Billing & Plan */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#FEE2E2",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  💳
                </div>
                <Text as="h2" variant="headingMd">{t("billingPlan")}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between" blockAlign="center" wrap>
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {shopInfo?.plan?.name ?? "Free"}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("billingDesc")}
                  </Text>
                </BlockStack>
                <Button variant="secondary" url="/app/billing">
                  {t("viewPricing")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Security & Privacy */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#E0E7FF",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  🛡️
                </div>
                <Text as="h2" variant="headingMd">{t("security")}</Text>
              </InlineStack>
              <Divider />
              <BlockStack gap="300">
                {[
                  { title: t("dataEncryption"), desc: t("dataEncryptionDesc") },
                  { title: t("soc2"), desc: t("soc2Desc") },
                  { title: t("gdpr"), desc: t("gdprDesc") },
                ].map(({ title, desc }) => (
                  <InlineStack key={title} gap="300" blockAlign="start">
                    <Text as="span" variant="bodyMd">✅</Text>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
                      <Text as="span" variant="bodySm" tone="subdued">{desc}</Text>
                    </BlockStack>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

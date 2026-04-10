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
import { useSearchParams } from "next/navigation";
import { withShopParams } from "@/lib/withShopParams";
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
  TextField,
  Banner,
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

interface AutomationSettings {
  auto_build_enabled: boolean;
  auto_save_enabled: boolean;
  auto_save_min_score: number;
  enforce_no_blockers: boolean;
}

export default function EmbeddedSettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const searchParams = useSearchParams();
  const [shopInfo, setShopInfo] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const [notifNewDispute, setNotifNewDispute] = useState(true);
  const [notifBeforeDue, setNotifBeforeDue] = useState(true);
  const [notifEvidenceReady, setNotifEvidenceReady] = useState(false);

  const [automation, setAutomation] = useState<AutomationSettings>({
    auto_build_enabled: false,
    auto_save_enabled: false,
    auto_save_min_score: 80,
    enforce_no_blockers: true,
  });
  const [minScoreInput, setMinScoreInput] = useState("80");
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationSaved, setAutomationSaved] = useState(false);

  const fetchInfo = useCallback(async () => {
    setLoading(true);
    try {
      const [usageRes, prefsRes, autoRes] = await Promise.all([
        fetch("/api/billing/usage"),
        fetch("/api/shop/preferences"),
        fetch("/api/automation/settings"),
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
      if (autoRes.ok) {
        const a = await autoRes.json() as AutomationSettings;
        setAutomation(a);
        setMinScoreInput(String(a.auto_save_min_score));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const saveAutomation = useCallback(async () => {
    const score = Math.min(100, Math.max(0, parseInt(minScoreInput, 10) || 0));
    setAutomationSaving(true);
    await fetch("/api/automation/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto_build_enabled: automation.auto_build_enabled,
        auto_save_enabled: automation.auto_save_enabled,
        auto_save_min_score: score,
        enforce_no_blockers: automation.enforce_no_blockers,
      }),
    });
    setAutomationSaving(false);
    setAutomationSaved(true);
    setTimeout(() => setAutomationSaved(false), 3000);
  }, [automation, minScoreInput]);

  const persistNotification = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      await fetch("/api/shop/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications: { [key]: value } }),
      });
    },
    []
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
                      <Badge tone="success">{t("active")}</Badge>
                    </InlineStack>
                  </BlockStack>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Notifications — before automation (daily relevance) */}
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

        {/* Advanced Automation Defaults */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "#EDE9FE",
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  ⚡
                </div>
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">{t("automationSection")}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">Advanced defaults — for policy configuration, see Automation</Text>
                </BlockStack>
              </InlineStack>
              <Divider />
              {loading ? (
                <Spinner size="small" />
              ) : (
                <BlockStack gap="400">
                  {/* Auto Build */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("autoBuildLabel")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("autoBuildDesc")}</Text>
                      </BlockStack>
                      <Checkbox
                        label=""
                        checked={automation.auto_build_enabled}
                        onChange={(v) => setAutomation((a) => ({ ...a, auto_build_enabled: v }))}
                        labelHidden
                      />
                    </InlineStack>
                  </div>

                  {/* Auto Save */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("autoSaveLabel")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("autoSaveDesc")}</Text>
                      </BlockStack>
                      <Checkbox
                        label=""
                        checked={automation.auto_save_enabled}
                        onChange={(v) => setAutomation((a) => ({ ...a, auto_save_enabled: v }))}
                        labelHidden
                      />
                    </InlineStack>
                  </div>

                  {/* Min Score */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("minScore")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("minScoreHelp")}</Text>
                      </BlockStack>
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <TextField
                          label=""
                          labelHidden
                          type="number"
                          value={minScoreInput}
                          onChange={setMinScoreInput}
                          min={0}
                          max={100}
                          suffix="%"
                          autoComplete="off"
                        />
                      </div>
                    </InlineStack>
                  </div>

                  {/* Blocker Gate */}
                  <div style={{ padding: "12px", border: "1px solid var(--p-color-border)", borderRadius: 8 }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="medium">{t("blockerLabel")}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{t("blockerDesc")}</Text>
                      </BlockStack>
                      <Checkbox
                        label=""
                        checked={automation.enforce_no_blockers}
                        onChange={(v) => setAutomation((a) => ({ ...a, enforce_no_blockers: v }))}
                        labelHidden
                      />
                    </InlineStack>
                  </div>

                  {automationSaved && (
                    <Banner tone="success">{t("saveAutomation")} ✓</Banner>
                  )}

                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      onClick={() => void saveAutomation()}
                      loading={automationSaving}
                    >
                      {t("saveAutomation")}
                    </Button>
                  </InlineStack>
                </BlockStack>
              )}
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
                <Button variant="primary" url={withShopParams("/portal/team", searchParams)}>
                  {t("inviteMember")}
                </Button>
              </InlineStack>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">{t("teamManagedInPortal")}</Text>
              <Button url={withShopParams("/portal/team", searchParams)} variant="plain">{t("manageTeam")}</Button>
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
                <Button variant="secondary" url={withShopParams("/app/billing", searchParams)}>
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

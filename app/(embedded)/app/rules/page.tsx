/**
 * FIGMA SCREEN MAPPING (file key: 5o2yOdPqVmvwjaK8eTeUUx)
 * Route: app/(embedded)/app/rules/page.tsx
 * Figma Make source: src/app/pages/shopify/shopify-rules.tsx
 * Reference: header "Set up rules to automatically route disputes and create evidence packs",
 * info banner "How automation rules work", rules list (priority number, name, status badge,
 * disputes processed, trigger/action labels, chevron). "Create Rule" primary action.
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  Spinner,
  InlineStack,
  BlockStack,
  Banner,
} from "@shopify/polaris";

interface Rule {
  id: string;
  name: string | null;
  enabled: boolean;
  match: { reason?: string[]; status?: string[]; amount_range?: { min?: number; max?: number } };
  action: {
    mode: "auto_pack" | "review" | "manual";
    pack_template_id?: string | null;
    require_fields?: string[];
  };
  priority: number;
}

const REASON_KEYS: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "productNotReceived",
  PRODUCT_UNACCEPTABLE: "productUnacceptable",
  FRAUDULENT: "fraudulent",
  CREDIT_NOT_PROCESSED: "creditNotProcessed",
  SUBSCRIPTION_CANCELED: "subscriptionCanceled",
  DUPLICATE: "duplicate",
  GENERAL: "general",
};

function matchSummary(match: Rule["match"], tRules: (k: string) => string): string {
  const parts: string[] = [];
  if (match.reason?.length) {
    const translated = match.reason.map((r) => REASON_KEYS[r] ? r.replace(/_/g, " ") : r);
    parts.push(`${tRules("reason")}: ${translated.join(", ")}`);
  }
  if (match.status?.length) parts.push(`${tRules("statusLabel")}: ${match.status.join(", ")}`);
  if (match.amount_range) {
    const { min, max } = match.amount_range;
    if (min != null && max != null) parts.push(`$${min}–$${max}`);
    else if (min != null) parts.push(`≥ $${min}`);
    else if (max != null) parts.push(`≤ $${max}`);
  }
  return parts.length ? parts.join(" · ") : tRules("matchesAll");
}

function statusTone(enabled: boolean): "success" | "warning" | undefined {
  return enabled ? "success" : "warning";
}

export default function EmbeddedRulesPage() {
  const router = useRouter();
  const t = useTranslations();
  const tr = useTranslations("rules");
  const tn = useTranslations("nav");
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  const shopId =
    typeof window !== "undefined"
      ? document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? ""
      : "";

  const fetchRules = useCallback(async () => {
    if (!shopId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/rules?shop_id=${shopId}`);
      if (res.ok) {
        const data = await res.json();
        setRules(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  return (
    <Page
      title={tn("rules")}
      subtitle={tr("subtitle")}
      primaryAction={{
        content: tr("addRule"),
        url: "/portal/rules",
      }}
    >
      <Layout>
        {/* Info banner — "How automation rules work" */}
        <Layout.Section>
          <Banner tone="info" title={t("dashboard.howItWorks")}>
            <p>{t("dashboard.howItWorksStep1")}</p>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          {loading ? (
            <Card>
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Spinner size="large" />
              </div>
            </Card>
          ) : rules.length === 0 ? (
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Text as="h3" variant="headingMd">{t("disputes.noDisputesYet")}</Text>
                <Text as="p" variant="bodyMd" tone="subdued">{tr("subtitle")}</Text>
                <Button variant="primary" url="/portal/rules">
                  {tr("addRule")}
                </Button>
              </BlockStack>
            </Card>
          ) : (
            <BlockStack gap="300">
              {rules
                .sort((a, b) => a.priority - b.priority)
                .map((rule, index) => (
                  <Card key={rule.id}>
                    <InlineStack gap="400" blockAlign="start" wrap={false}>
                      {/* Priority badge */}
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          background: "linear-gradient(135deg, #1D4ED8, #3B82F6)",
                          borderRadius: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "white",
                          fontWeight: 700,
                          fontSize: 14,
                          flexShrink: 0,
                        }}
                      >
                        {index + 1}
                      </div>

                      {/* Rule content */}
                      <BlockStack gap="200" as="div" inlineAlign="start">
                        <InlineStack align="space-between" blockAlign="center" wrap>
                          <BlockStack gap="100">
                            <Text as="h3" variant="bodyMd" fontWeight="semibold">
                              {rule.name ?? tr("unnamedRule")}
                            </Text>
                            <Badge tone={statusTone(rule.enabled)}>
                              {rule.enabled ? tr("active") : tr("inactive")}
                            </Badge>
                          </BlockStack>
                          <Button
                            variant="plain"
                            onClick={() => router.push("/portal/rules")}
                          >
                            ›
                          </Button>
                        </InlineStack>

                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="start">
                            <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
                              {tr("triggerCondition")}:
                            </Text>
                            <Text as="span" variant="bodySm">
                              {matchSummary(rule.match, tr)}
                            </Text>
                          </InlineStack>
                          <InlineStack gap="200" blockAlign="start">
                            <Text as="span" variant="bodySm" fontWeight="medium" tone="subdued">
                              {tr("action")}:
                            </Text>
                            <Text as="span" variant="bodySm">
                              {rule.action?.mode === "auto_pack"
                                ? tr("autoPack")
                                : rule.action?.mode === "manual"
                                  ? tr("manual")
                                  : tr("review")}
                            </Text>
                          </InlineStack>
                        </BlockStack>
                      </BlockStack>
                    </InlineStack>
                  </Card>
                ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

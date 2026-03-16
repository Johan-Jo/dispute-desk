"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Box,
  Divider,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { PolicyTemplateType } from "@/lib/policy-templates/library";
import type { StepId } from "@/lib/setup/types";

const POLICY_ROWS = [
  { key: "returns", libraryType: "refunds" as PolicyTemplateType, defaultPath: "/policies/refund-policy" },
  { key: "shipping", libraryType: "shipping" as PolicyTemplateType, defaultPath: "/policies/shipping-policy" },
  { key: "terms", libraryType: "terms" as PolicyTemplateType, defaultPath: "/policies/terms-of-service" },
  { key: "privacy", libraryType: "privacy" as PolicyTemplateType, defaultPath: "/policies/privacy-policy" },
  { key: "contact", libraryType: "contact" as PolicyTemplateType, defaultPath: "/pages/contact" },
] as const;

type PolicyKey = (typeof POLICY_ROWS)[number]["key"];

interface TemplateMeta {
  type: PolicyTemplateType;
  name: string;
  description: string;
  qualityBadge: string;
}

type PolicyState =
  | { source: "url"; url: string }
  | { source: "template"; content: string; loading?: boolean };

interface ShopDetails {
  name: string;
  email: string;
  phone: string;
  primaryDomain: string;
}

function getShopId(): string | null {
  return document.cookie.match(/shopify_shop_id=([^;]+)/)?.[1] ?? null;
}

interface BusinessPoliciesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function BusinessPoliciesStep({ stepId, onSaveRef }: BusinessPoliciesStepProps) {
  const t = useTranslations("setup.policies");

  const [policies, setPolicies] = useState<Record<PolicyKey, PolicyState>>({
    returns: { source: "url", url: "" },
    shipping: { source: "url", url: "" },
    terms: { source: "url", url: "" },
    privacy: { source: "url", url: "" },
    contact: { source: "url", url: "" },
  });

  const [templateMeta, setTemplateMeta] = useState<Record<string, TemplateMeta>>({});
  const [metaLoading, setMetaLoading] = useState(true);
  const [shopDetails, setShopDetails] = useState<ShopDetails | null>(null);

  // Fetch template metadata + shop details in parallel on mount
  useEffect(() => {
    fetch("/api/policy-templates")
      .then((r) => r.json())
      .then((data: { templates: Array<{ type: string; name: string; description: string; qualityBadge: string }> }) => {
        const map: Record<string, TemplateMeta> = {};
        for (const tpl of data.templates ?? []) {
          map[tpl.type] = { type: tpl.type as PolicyTemplateType, name: tpl.name, description: tpl.description, qualityBadge: tpl.qualityBadge };
        }
        setTemplateMeta(map);
      })
      .catch(() => {})
      .finally(() => setMetaLoading(false));

    const shopId = getShopId();
    if (shopId) {
      fetch(`/api/shop/details?shop_id=${shopId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((details: ShopDetails | null) => {
          if (!details) return;
          setShopDetails(details);
          // Pre-fill URL fields with shop's primary domain
          const origin = details.primaryDomain.replace(/\/$/, "");
          setPolicies((prev) => {
            const next = { ...prev };
            for (const row of POLICY_ROWS) {
              const current = prev[row.key];
              if (current.source === "url" && !current.url) {
                next[row.key] = { source: "url", url: `${origin}${row.defaultPath}` };
              }
            }
            return next;
          });
        })
        .catch(() => {});
    }
  }, []);

  const loadTemplate = useCallback(async (key: PolicyKey, libraryType: PolicyTemplateType) => {
    setPolicies((prev) => ({ ...prev, [key]: { source: "template", content: "", loading: true } }));
    try {
      const shopId = getShopId();
      const qs = shopId ? `?shop_id=${shopId}` : "";
      const res = await fetch(`/api/policy-templates/${libraryType}/content${qs}`);
      const { body } = await res.json();
      setPolicies((prev) => ({ ...prev, [key]: { source: "template", content: body ?? "" } }));
    } catch {
      setPolicies((prev) => ({ ...prev, [key]: { source: "template", content: "" } }));
    }
  }, []);

  function setUrl(key: PolicyKey, url: string) {
    setPolicies((prev) => ({ ...prev, [key]: { source: "url", url } }));
  }

  function setContent(key: PolicyKey, content: string) {
    setPolicies((prev) => ({ ...prev, [key]: { source: "template", content } }));
  }

  function removeTemplate(key: PolicyKey) {
    const row = POLICY_ROWS.find((r) => r.key === key)!;
    const origin = shopDetails?.primaryDomain.replace(/\/$/, "") ?? "";
    const defaultUrl = origin ? `${origin}${row.defaultPath}` : "";
    setPolicies((prev) => ({ ...prev, [key]: { source: "url", url: defaultUrl } }));
  }

  useEffect(() => {
    onSaveRef.current = async () => {
      const shopId = getShopId();

      for (const row of POLICY_ROWS) {
        const p = policies[row.key];
        if (p.source !== "template") continue;
        const applyRes = await fetch("/api/policies/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shopId, policy_type: row.libraryType, content: p.content }),
        });
        if (!applyRes.ok) return false;
      }

      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, payload: { policies } }),
      });
      return res.ok;
    };
  }, [stepId, onSaveRef, policies]);

  return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">
        {t("title")}
      </Text>
      <Text as="p" variant="bodyMd" tone="subdued">
        {t("subtitle")}
      </Text>

      <BlockStack gap="300">
        {POLICY_ROWS.map((row, i) => {
          const policy = policies[row.key];
          const meta = templateMeta[row.libraryType];
          const isTemplate = policy.source === "template";
          const isLoading = isTemplate && (policy as { loading?: boolean }).loading;

          return (
            <Box key={row.key}>
              {i > 0 && <Divider />}
              <Box paddingBlockStart={i > 0 ? "300" : "0"}>
                <BlockStack gap="200">
                  {/* Row header */}
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {t(`${row.key}Label` as Parameters<typeof t>[0])}
                      </Text>
                      {isTemplate && meta && (
                        <Badge tone="success">{meta.qualityBadge}</Badge>
                      )}
                    </InlineStack>
                    {isTemplate ? (
                      <Button variant="plain" size="slim" onClick={() => removeTemplate(row.key)}>
                        {t("removeTemplate")}
                      </Button>
                    ) : metaLoading ? (
                      <Spinner size="small" />
                    ) : (
                      <Button variant="plain" size="slim" onClick={() => loadTemplate(row.key, row.libraryType)}>
                        {t("useTemplate")}
                      </Button>
                    )}
                  </InlineStack>

                  {/* Content */}
                  {isTemplate ? (
                    isLoading ? (
                      <InlineStack align="center">
                        <Spinner size="small" />
                      </InlineStack>
                    ) : (
                      <TextField
                        label={t(`${row.key}Label` as Parameters<typeof t>[0])}
                        labelHidden
                        value={(policy as { content: string }).content}
                        onChange={(val) => setContent(row.key, val)}
                        multiline={8}
                        autoComplete="off"
                        helpText={t("templateHelpText")}
                        monospaced
                      />
                    )
                  ) : (
                    <TextField
                      label={t(`${row.key}Label` as Parameters<typeof t>[0])}
                      labelHidden
                      value={(policy as { url: string }).url}
                      onChange={(val) => setUrl(row.key, val)}
                      type="url"
                      placeholder={t(`${row.key}Placeholder` as Parameters<typeof t>[0])}
                      autoComplete="off"
                    />
                  )}
                </BlockStack>
              </Box>
            </Box>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}

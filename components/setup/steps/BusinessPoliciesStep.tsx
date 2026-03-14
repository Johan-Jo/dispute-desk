"use client";

import { useEffect, useState } from "react";
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

// Wizard policy types and their matching library types
const POLICY_ROWS = [
  { key: "returns", libraryType: "refunds" as PolicyTemplateType },
  { key: "shipping", libraryType: "shipping" as PolicyTemplateType },
  { key: "terms", libraryType: "terms" as PolicyTemplateType },
  { key: "privacy", libraryType: "privacy" as PolicyTemplateType },
  { key: "contact", libraryType: "contact" as PolicyTemplateType },
] as const;

type PolicyKey = (typeof POLICY_ROWS)[number]["key"];

interface TemplateMeta {
  type: PolicyTemplateType;
  name: string;
  description: string;
  qualityBadge: string;
}

interface PolicyState {
  url: string;
  source: "url" | "template";
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
    returns: { url: "", source: "url" },
    shipping: { url: "", source: "url" },
    terms: { url: "", source: "url" },
    privacy: { url: "", source: "url" },
    contact: { url: "", source: "url" },
  });

  const [templateMeta, setTemplateMeta] = useState<Record<string, TemplateMeta>>({});
  const [metaLoading, setMetaLoading] = useState(true);

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
  }, []);

  function setUrl(key: PolicyKey, url: string) {
    setPolicies((prev) => ({ ...prev, [key]: { url, source: "url" } }));
  }

  function selectTemplate(key: PolicyKey) {
    setPolicies((prev) => ({ ...prev, [key]: { url: "", source: "template" } }));
  }

  function removeTemplate(key: PolicyKey) {
    setPolicies((prev) => ({ ...prev, [key]: { url: "", source: "url" } }));
  }

  useEffect(() => {
    onSaveRef.current = async () => {
      const shopId = getShopId();

      // Apply templates for template-sourced policies
      for (const row of POLICY_ROWS) {
        if (policies[row.key].source !== "template") continue;
        const contentRes = await fetch(`/api/policy-templates/${row.libraryType}/content`);
        if (!contentRes.ok) return false;
        const { body } = await contentRes.json();

        const applyRes = await fetch("/api/policies/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shopId, policy_type: row.libraryType, content: body }),
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

          return (
            <Box key={row.key}>
              {i > 0 && <Divider />}
              <Box paddingBlockStart={i > 0 ? "300" : "0"}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {t(`${row.key}Label` as Parameters<typeof t>[0])}
                    </Text>
                    {!isTemplate && (
                      metaLoading ? (
                        <Spinner size="small" />
                      ) : (
                        <Button variant="plain" size="slim" onClick={() => selectTemplate(row.key)}>
                          {t("useTemplate")}
                        </Button>
                      )
                    )}
                  </InlineStack>

                  {isTemplate && meta ? (
                    <Box
                      background="bg-surface-secondary"
                      borderRadius="200"
                      padding="300"
                    >
                      <InlineStack align="space-between" blockAlign="start" wrap={false}>
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {meta.name}
                            </Text>
                            <Badge tone="success">{meta.qualityBadge}</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {meta.description}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("templateNote")}
                          </Text>
                        </BlockStack>
                        <Button variant="plain" size="slim" onClick={() => removeTemplate(row.key)}>
                          {t("removeTemplate")}
                        </Button>
                      </InlineStack>
                    </Box>
                  ) : isTemplate && !meta ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("templateNote")}
                    </Text>
                  ) : (
                    <TextField
                      label={t(`${row.key}Label` as Parameters<typeof t>[0])}
                      labelHidden
                      value={policy.url}
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

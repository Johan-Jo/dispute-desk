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
} from "@shopify/polaris";
import { useTranslations } from "next-intl";
import type { StepId } from "@/lib/setup/types";

type PolicySource = "url" | "template";

interface PolicyState {
  url: string;
  source: PolicySource;
}

const POLICY_TYPES = ["returns", "shipping", "terms", "privacy", "contact"] as const;
type PolicyType = (typeof POLICY_TYPES)[number];

const defaultState = (): PolicyState => ({ url: "", source: "url" });

interface BusinessPoliciesStepProps {
  stepId: StepId;
  onSaveRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

export function BusinessPoliciesStep({ stepId, onSaveRef }: BusinessPoliciesStepProps) {
  const t = useTranslations("setup.policies");

  const [policies, setPolicies] = useState<Record<PolicyType, PolicyState>>({
    returns: defaultState(),
    shipping: defaultState(),
    terms: defaultState(),
    privacy: defaultState(),
    contact: defaultState(),
  });

  function setUrl(type: PolicyType, url: string) {
    setPolicies((prev) => ({
      ...prev,
      [type]: { url, source: "url" },
    }));
  }

  function useTemplate(type: PolicyType) {
    setPolicies((prev) => ({
      ...prev,
      [type]: { url: "", source: "template" },
    }));
  }

  useEffect(() => {
    onSaveRef.current = async () => {
      const res = await fetch("/api/setup/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          payload: { policies },
        }),
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
        {POLICY_TYPES.map((type, i) => {
          const policy = policies[type];
          const isTemplate = policy.source === "template";
          return (
            <Box key={type}>
              {i > 0 && <Divider />}
              <Box paddingBlockStart={i > 0 ? "300" : "0"}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {t(`${type}Label` as Parameters<typeof t>[0])}
                    </Text>
                    <Button
                      variant="plain"
                      size="slim"
                      disabled={isTemplate}
                      onClick={() => useTemplate(type)}
                    >
                      {isTemplate ? t("templateApplied") : t("useTemplate")}
                    </Button>
                  </InlineStack>

                  {isTemplate ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("templateNote")}
                    </Text>
                  ) : (
                    <TextField
                      label={t(`${type}Label` as Parameters<typeof t>[0])}
                      labelHidden
                      value={policy.url}
                      onChange={(val) => setUrl(type, val)}
                      type="url"
                      placeholder={t(`${type}Placeholder` as Parameters<typeof t>[0])}
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
